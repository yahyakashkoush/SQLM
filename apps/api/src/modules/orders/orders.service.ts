import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Order } from '@prisma/client';
import type { OrderStatus, PaginatedResult } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { InsufficientInventoryError } from '../inventory/errors/insufficient-inventory.error';
import { assertTransitionAllowed } from './order-state-machine';
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

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: toStatus,
        ...(toStatus === 'PAID' ? { paidAt: new Date() } : {}),
        ...(toStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        ...(toStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(toStatus === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: note } : {}),
      },
    });

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

    return updated;
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

  async findByIdForCustomer(id: string, customerId: string): Promise<OrderWithItems> {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId },
      include: { items: true },
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

  async findByIdAdmin(id: string): Promise<OrderWithItems> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async listAdmin(query: OrderQueryDto): Promise<PaginatedResult<OrderWithItems>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.OrderWhereInput = query.status ? { status: query.status } : {};

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
}

// Re-exported so callers translating errors to HTTP don't need to import from two places.
export { InsufficientInventoryError };
