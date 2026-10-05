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
import {
  PaymentMethodUnavailableError,
  OrderNotCancellableError,
  OrderPriceChangedError,
} from './errors/order.errors';
import { CryptoWatchService } from '../crypto-payments/crypto-watch.service';
import { CouponsService } from '../coupons/coupons.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { CartPricingService } from './cart-pricing.service';
import type { CheckoutDto, QuoteOrderDto } from './dto/checkout.dto';
import type { OrderQueryDto } from './dto/order-query.dto';

type PrismaTx = Prisma.TransactionClient;

export interface OrderActor {
  type: 'CUSTOMER' | 'STAFF' | 'SYSTEM';
  staffId?: string;
  customerId?: string;
}

const ORDER_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Where a customer may still cancel on their own. The state machine also
 * allows CANCELLED out of PAYMENT_SUBMITTED and PAYMENT_REVIEW, but by
 * then a transfer may be in flight and staff may be mid-approval, so those
 * two stay a support decision.
 */
const CUSTOMER_CANCELLABLE_STATUSES: readonly OrderStatus[] = ['CREATED', 'PENDING_PAYMENT'];

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
    private readonly cryptoWatch: CryptoWatchService,
    private readonly pricing: CartPricingService,
    private readonly coupons: CouponsService,
    private readonly loyalty: LoyaltyService,
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

    // Priced before the transaction opens, by the same function the quote
    // endpoint uses, so the customer is charged the total they were shown.
    // Claims (gift, coupon) happen inside the transaction below.
    const quote = await this.pricing.quote(customerId, dto.items, dto.couponCode);
    const { currency, subtotal, productById, member, discountTotal, total } = quote;
    const couponQuote = quote.coupon;

    // The client sends the total it displayed. If anything moved since —
    // a discount setting, the coupon, the gift — refuse rather than charge
    // a number the customer never saw.
    if (dto.expectedTotal !== undefined && !total.equals(dto.expectedTotal)) {
      throw new OrderPriceChangedError(String(dto.expectedTotal), total.toString());
    }

    // Frozen onto the order with its rate, so the EGP amount an order asks
    // for never moves when the admin changes the rate later.
    const conversion = await this.pricing.conversionFor(total, currency, paymentMethod);

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            customerId,
            currency,
            subtotal,
            discountTotal,
            memberDiscount: member?.amount ?? 0,
            memberDiscountKind: member?.kind,
            total,
            couponId: couponQuote?.couponId,
            couponCode: couponQuote?.code,
            payCurrency: conversion?.currency,
            payAmount: conversion?.amount,
            exchangeRate: conversion?.rate,
            paymentMethodId: dto.paymentMethodId,
            idempotencyKey: dto.idempotencyKey,
          },
        });

        // A welcome gift the quote included must be claimable now; if a
        // concurrent first order took it, this checkout's price is wrong.
        if (member?.kind === 'WELCOME' && !(await this.loyalty.claimWelcomeGift(tx, customerId, created.id))) {
          throw new OrderPriceChangedError(total.toString(), total.add(member.amount).toString());
        }

        if (couponQuote) {
          // Inside the transaction: if anything below fails — out of
          // stock, a lost idempotency race — the redemption rolls back
          // with the order and the code is not burned.
          await this.coupons.redeem(tx, couponQuote, customerId, created.id);
        }

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

      if (paymentMethod.provider !== 'MANUAL') {
        // Best-effort: the order is already committed, so a hiccup here
        // must not fail the checkout the customer just completed. The
        // payment page opens the watch on demand if this didn't.
        try {
          await this.cryptoWatch.openWatch(order.id, paymentMethod);
        } catch (err) {
          this.logger.error(
            `Could not open crypto watch for order ${order.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

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
   * The checkout page's price: every line of the breakdown, and what the
   * transfer comes to with each enabled payment method. Same pricing
   * function as `checkout`, so what is shown here is what is charged.
   */
  async quoteForCustomer(customerId: string, dto: QuoteOrderDto) {
    const quote = await this.pricing.quote(customerId, dto.items, dto.couponCode);
    const methods = await this.prisma.paymentMethod.findMany({
      where: { enabled: true },
      select: { id: true, currency: true, provider: true },
    });
    const paymentOptions = await Promise.all(
      methods.map(async (method) => {
        const conversion = await this.pricing.conversionFor(quote.total, quote.currency, method);
        return {
          paymentMethodId: method.id,
          currency: conversion?.currency ?? quote.currency,
          amount: (conversion?.amount ?? quote.total).toString(),
          rate: conversion?.rate.toString() ?? null,
        };
      }),
    );

    return {
      currency: quote.currency,
      subtotal: quote.subtotal.toString(),
      member: quote.member
        ? { kind: quote.member.kind, percent: quote.member.percent, amount: quote.member.amount.toString() }
        : null,
      coupon: quote.coupon ? { code: quote.coupon.code, discount: quote.coupon.discount.toString() } : null,
      discountTotal: quote.discountTotal.toString(),
      total: quote.total.toString(),
      paymentOptions,
    };
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
      // An order that never went through should not cost the customer
      // their gift or a use of their coupon.
      await this.loyalty.releaseWelcomeGift(tx, orderId);
      await this.coupons.releaseForOrder(tx, orderId);
    }
    let becameVerified = false;
    if (toStatus === 'PAID') {
      await this.inventory.markIndividualItemsSold(tx, orderId);
      becameVerified = await this.loyalty.verifyOnPayment(tx, order.customerId);
    }

    // Best-effort: dispatcher swallows its own failures, so an unreachable
    // queue/stream can never roll back the transition itself.
    const message = await this.customerStatusMessage(
      tx,
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

    if (becameVerified) {
      const customer = await tx.customer.findUnique({
        where: { id: order.customerId },
        select: { firstName: true },
      });
      await this.notifications.notifyCustomer(order.customerId, {
        kind: 'customer.verified',
        summary: await this.loyalty.verifiedMessage(customer?.firstName ?? null, tx),
        button: { text: '🛍️ تسوّق بخصمك', url: miniAppUrl },
      });
    }

    return updated;
  }

  /**
   * The Telegram text for a status change, or null when the step is
   * internal (payment review, processing) or covered by its own message
   * (deliveries) — the customer gets one message per meaningful event, not
   * a burst of five when an order is paid and auto-delivered.
   */
  private async customerStatusMessage(
    tx: PrismaTx,
    from: OrderStatus,
    to: OrderStatus,
    orderNumber: number,
    note?: string,
  ): Promise<string | null> {
    const silent =
      !['PAID', 'PENDING_PAYMENT', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'DISPUTED'].includes(to) ||
      (to === 'PENDING_PAYMENT' && from !== 'PAYMENT_REVIEW' && from !== 'PAYMENT_SUBMITTED');
    if (silent) return null;

    const values = { ...(await this.settings.storeValues(tx)), order_number: orderNumber };
    switch (to) {
      case 'PAID':
        return renderTemplate(await this.settings.getString('orders.paymentApprovedMessage', tx), values);
      case 'PENDING_PAYMENT':
        return renderTemplate(await this.settings.getString('orders.paymentRejectedMessage', tx), {
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
          select: { id: true, name: true, description: true, accountNumber: true, instructions: true, qrCodeUrl: true, currency: true, provider: true },
        },
        paymentProofs: {
          orderBy: { uploadedAt: 'desc' },
          select: { id: true, status: true, rejectionReason: true, uploadedAt: true },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, type: true, fromStatus: true, toStatus: true, note: true, createdAt: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /**
   * Staff-only refund: transitions the order to REFUNDED and optionally
   * releases reserved inventory back to stock. Inventory is only released when
   * `restock` is true — items that were already delivered should not be
   * restocked.
   */
  async refundOrder(
    orderId: string,
    actor: OrderActor,
    note: string,
    restock: boolean,
  ): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      if (restock) await this.releaseInventoryForOrder(tx, orderId);
      return this.transition(tx, orderId, 'REFUNDED', actor, note);
    });
  }

  /**
   * Lets a customer walk away from an order they have not paid for.
   *
   * Worth having for the inventory alone: a reserved item is unavailable
   * to everyone else until the order is cancelled, so without this a
   * customer who picked the wrong product silently holds stock until
   * their window lapses or someone notices. `transition()` releases the
   * reservation and messages them, so this only has to decide whether
   * they are allowed.
   *
   * Deliberately narrower than what the state machine permits. Once a
   * proof is uploaded or a review is underway, money may already have
   * moved and a self-cancel would race staff approving it — those go
   * through support.
   */
  async cancelByCustomer(orderId: string, customerId: string, reason?: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status as OrderStatus)) {
      throw new OrderNotCancellableError(order.status as OrderStatus);
    }

    // Before the transition: releasing the claimed amount back to the pool
    // is safe to repeat, and leaving it claimed would be worse than
    // cancelling twice.
    await this.cryptoWatch.cancelForOrder(orderId);

    return this.transitionStandalone(
      orderId,
      'CANCELLED',
      { type: 'CUSTOMER', customerId },
      reason?.trim() || 'ألغاه العميل',
    );
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
