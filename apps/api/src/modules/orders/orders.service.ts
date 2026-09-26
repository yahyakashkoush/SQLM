import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Order } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ORDER_STATUS_LABELS_AR, renderTemplate, type OrderStatus, type PaginatedResult } from '@sqlm/shared';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { InventoryService } from '../inventory/inventory.service';
import { InsufficientInventoryError } from '../inventory/errors/insufficient-inventory.error';
import { assertTransitionAllowed, InvalidOrderTransitionError } from './order-state-machine';
import { ProductNotPurchasableError, PaymentMethodUnavailableError } from './errors/order.errors';
import type { CheckoutDto } from './dto/checkout.dto';
import type { OrderQueryDto } from './dto/order-query.dto';

type PrismaTx = Prisma.TransactionClient;

export interface OrderActor {
  type: 'CUSTOMER' | 'STAFF' | 'SYSTEM';
  staffId?: string;
  customerId?: string;
}

const ORDER_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationDispatcher,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The only entry point that creates orders. Idempotent on
   * (customerId, idempotencyKey): a retried checkout — double-tap on
   * "Buy", a client retry after a dropped response — always returns the
   * *same* order instead of creating a second one, whether the retry lands
   * before or after (via the DB unique constraint, caught below) the first
   * request's transaction commits.
   */
  async checkout(customerId: string, dto: CheckoutDto): Promise<OrderWithItems> {
    const existing = await this.prisma.order.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey: dto.idempotencyKey } },
      include: { items: true },
    });
    if (existing) {
      this.logger.log(`Idempotent checkout replay for customer ${customerId}`);
      return existing;
    }

    const paymentMethod = await this.prisma.paymentMethod.findUnique({
      where: { id: dto.paymentMethodId },
    });
    if (!paymentMethod || !paymentMethod.enabled) {
      throw new PaymentMethodUnavailableError(dto.paymentMethodId);
    }

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    const productById = new Map(products.map((p) => [p.id, p]));

    let currency: string | undefined;
    let subtotal = new Prisma.Decimal(0);
    for (const item of dto.items) {
      const product = productById.get(item.productId);
      if (!product || product.status !== 'ACTIVE' || product.visibility !== 'VISIBLE') {
        throw new ProductNotPurchasableError(item.productId);
      }
      if (currency && currency !== product.currency) {
        throw new ProductNotPurchasableError(item.productId);
      }
      currency = product.currency;
      subtotal = subtotal.add(product.price.mul(item.quantity));
    }

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            customerId,
            currency: currency!,
            subtotal,
            total: subtotal,
            paymentMethodId: dto.paymentMethodId,
            idempotencyKey: dto.idempotencyKey,
          },
        });

        for (const item of dto.items) {
          const product = productById.get(item.productId)!;
          await tx.orderItem.create({
            data: {
              orderId: created.id,
              productId: product.id,
              productNameSnapshot: product.name,
              deliveryTypeSnapshot: product.deliveryType,
              fulfillmentTypeSnapshot: product.fulfillmentType,
              unitPrice: product.price,
              quantity: item.quantity,
            },
          });

          if (product.inventoryMode === 'INDIVIDUAL') {
            await this.inventory.reserveIndividualItems(tx, product.id, item.quantity, created.id);
          } else {
            await this.inventory.reserveQuantity(tx, product.id, item.quantity);
          }
        }

        await tx.orderEvent.create({
          data: {
            orderId: created.id,
            type: 'INVENTORY_RESERVED',
            actorType: 'CUSTOMER',
            actorCustomerId: customerId,
          },
        });

        await this.transition(tx, created.id, 'PENDING_PAYMENT', { type: 'CUSTOMER', customerId });

        return tx.order.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } });
      });

      this.logger.log(`Checkout created order ${order.id} for customer ${customerId}`);
      await this.notifications.notifyStaff({
        kind: 'order.created',
        orderId: order.id,
        summary: `New order #${order.sequenceNumber} — ${order.total} ${order.currency}`,
      });
      return order;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === ORDER_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        // Lost the race to a concurrent request with the same idempotency key.
        const winner = await this.prisma.order.findUnique({
          where: { customerId_idempotencyKey: { customerId, idempotencyKey: dto.idempotencyKey } },
          include: { items: true },
        });
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * The only code path allowed to write `Order.status`. Validates the
   * transition, updates the row, and records an `OrderEvent` — always
   * together, always in the caller's transaction. Side effects (releasing
   * reserved inventory on cancellation, marking individual items sold on
   * payment approval) live here too, so they can never be forgotten by a
   * caller that only remembers to flip the status.
   */
  async transition(
    tx: PrismaTx,
    orderId: string,
    toStatus: OrderStatus,
    actor: OrderActor,
    note?: string,
  ): Promise<Order> {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    assertTransitionAllowed(order.status as OrderStatus, toStatus);

    // Guarded on the status we just read: two concurrent transitions out of
    // the same state race here, and the loser updates 0 rows instead of
    // both proceeding on a stale read. Without this the read-then-write
    // above is a TOCTOU window — three simultaneous payment-proof uploads
    // each saw PENDING_PAYMENT and each created a proof.
    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: {
        status: toStatus,
        ...(toStatus === 'PAID' ? { paidAt: new Date() } : {}),
        ...(toStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        ...(toStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(toStatus === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: note } : {}),
      },
    });
    if (claimed.count === 0) {
      const current = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      throw new InvalidOrderTransitionError(current.status as OrderStatus, toStatus);
    }
    const updated = await tx.order.findUniqueOrThrow({ where: { id: orderId } });

    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'STATUS_CHANGED',
        fromStatus: order.status,
        toStatus,
        actorType: actor.type,
        actorStaffId: actor.staffId,
        actorCustomerId: actor.customerId,
        note,
      },
    });

    if (toStatus === 'CANCELLED') {
      await this.releaseInventoryForOrder(tx, orderId);
    }
    if (toStatus === 'PAID') {
      await this.inventory.markIndividualItemsSold(tx, orderId);
    }

    // Best-effort: dispatcher swallows its own failures, so an unreachable
    // queue/stream can never roll back the transition itself.
    const message = await this.customerStatusMessage(
      order.status as OrderStatus,
      toStatus,
      updated.sequenceNumber,
      note,
    );
    const miniAppUrl = (this.config.get<string>('MINIAPP_URL') || 'http://localhost:3200').replace(/\/$/, '');
    await this.notifications.notifyCustomer(order.customerId, {
      kind: 'order.status_changed',
      orderId,
      status: toStatus,
      summary: message ?? `📦 طلب #${updated.sequenceNumber}: ${ORDER_STATUS_LABELS_AR[toStatus]}`,
      silent: message === null,
      button: { text: '📦 عرض الطلب', url: `${miniAppUrl}/orders/${orderId}` },
    });

    return updated;
  }

  /**
   * The Telegram text for a status change, or null when the step is
   * internal (payment review, processing) or covered by its own message
   * (deliveries) — the customer gets one message per meaningful event, not
   * a burst of five when an order is paid and auto-delivered.
   */
  private async customerStatusMessage(
    from: OrderStatus,
    to: OrderStatus,
    orderNumber: number,
    note?: string,
  ): Promise<string | null> {
    const values = { ...(await this.settings.storeValues()), order_number: orderNumber };
    switch (to) {
      case 'PAID':
        return renderTemplate(await this.settings.getString('orders.paymentApprovedMessage'), values);
      case 'PENDING_PAYMENT':
        if (from !== 'PAYMENT_REVIEW' && from !== 'PAYMENT_SUBMITTED') return null;
        return renderTemplate(await this.settings.getString('orders.paymentRejectedMessage'), {
          ...values,
          reason: note || '—',
        });
      case 'COMPLETED':
        return `🎉 طلبك #${orderNumber} اكتمل. شكراً لتعاملك مع ${values.store_name}!`;
      case 'CANCELLED':
        return `❌ تم إلغاء طلبك #${orderNumber}.${note ? `\nالسبب: ${note}` : ''}`;
      case 'REFUNDED':
        return `💸 تم استرداد مبلغ طلبك #${orderNumber}.${note ? `\n${note}` : ''}`;
      case 'DISPUTED':
        return `⚠️ طلبك #${orderNumber} قيد المراجعة، وفريق الدعم هيتواصل معاك.`;
      default:
        return null;
    }
  }

  /** Convenience wrapper for callers (e.g. the admin transition endpoint) that don't already have an open transaction. */
  async transitionStandalone(
    orderId: string,
    toStatus: OrderStatus,
    actor: OrderActor,
    note?: string,
  ): Promise<Order> {
    return this.prisma.$transaction((tx) => this.transition(tx, orderId, toStatus, actor, note));
  }

  private async releaseInventoryForOrder(tx: PrismaTx, orderId: string): Promise<void> {
    await this.inventory.releaseIndividualItems(tx, orderId);

    const items = await tx.orderItem.findMany({ where: { orderId }, include: { product: true } });
    for (const item of items) {
      if (item.product.inventoryMode === 'QUANTITY') {
        await this.inventory.releaseQuantity(tx, item.productId, item.quantity);
      }
    }
  }

  async findByIdForCustomer(id: string, customerId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId },
      include: {
        items: { include: { product: { select: { slug: true, images: true } } } },
        paymentMethod: {
          select: { id: true, name: true, description: true, accountNumber: true, instructions: true, qrCodeUrl: true, currency: true },
        },
        paymentProofs: {
          orderBy: { uploadedAt: 'desc' },
          select: { id: true, status: true, rejectionReason: true, uploadedAt: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async listForCustomer(
    customerId: string,
    query: OrderQueryDto,
  ): Promise<PaginatedResult<OrderWithItems>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.OrderWhereInput = {
      customerId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async findByIdAdmin(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, slug: true, images: true } } } },
        customer: true,
        paymentMethod: true,
        paymentProofs: { orderBy: { uploadedAt: 'desc' }, include: { reviewedBy: { select: { name: true } } } },
        events: {
          orderBy: { createdAt: 'desc' },
          include: { actorStaff: { select: { name: true } } },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return { ...order, customer: { ...order.customer, telegramId: order.customer.telegramId.toString() } };
  }

  async listAdmin(query: OrderQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim().replace(/^[#@]/, '');
    const orderNumber = search && /^\d+$/.test(search) ? Number(search) : undefined;
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              ...(orderNumber !== undefined && orderNumber < 2 ** 31 ? [{ sequenceNumber: orderNumber }] : []),
              { customer: { telegramUsername: { contains: search, mode: 'insensitive' } } },
              { customer: { firstName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          items: true,
          customer: { select: { id: true, firstName: true, telegramUsername: true } },
          paymentMethod: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
}

// Re-exported so callers translating errors to HTTP don't need to import from two places.
export { InsufficientInventoryError };
