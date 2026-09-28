import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type CryptoDeposit, type PaymentMethod, type PaymentProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { ExchangeRegistry } from './exchange/exchange-registry.service';
import { CryptoMethodMisconfiguredError, AmountAllocationFailedError } from './errors/crypto-payment.errors';

/**
 * Granularity of the identifying delta, in units of the asset. USDT is
 * 6dp on every chain a store is likely to use, so a delta below 1e-6
 * would be rounded away in transit and stop identifying anything.
 */
const DELTA_STEP = new Prisma.Decimal('0.000001');
/** Up to 9999 distinct deltas per base amount: worst case 0.009999 extra. */
const MAX_DELTA_UNITS = 9999;
/** Fresh random candidate each time; the unique index settles real races. */
const ALLOCATION_ATTEMPTS = 12;
/** A customer may push their deadline out this many times, then no more. */
const MAX_EXTENSIONS = 2;

export function buildClaimKey(
  provider: PaymentProvider,
  asset: string,
  network: string,
  amount: Prisma.Decimal,
): string {
  return `${provider}:${asset}:${network}:${amount.toFixed(8)}`;
}

@Injectable()
export class CryptoWatchService {
  private readonly logger = new Logger(CryptoWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ExchangeRegistry,
    private readonly notifications: NotificationDispatcher,
    private readonly config: ConfigService,
  ) {}

  /**
   * Opens the deposit watch for an order, allocating an amount no other
   * waiting order is using.
   *
   * Runs after the checkout transaction has committed rather than inside
   * it: allocation can lose a race on the unique index, and in Postgres a
   * constraint violation aborts the whole transaction, so a retry loop
   * only works on statements of its own.
   */
  async openWatch(orderId: string, method: PaymentMethod) {
    if (method.provider === 'MANUAL') {
      throw new CryptoMethodMisconfiguredError(method.id, 'provider is MANUAL');
    }
    if (!method.cryptoAsset || !method.cryptoNetwork || !method.depositAddress) {
      throw new CryptoMethodMisconfiguredError(
        method.id,
        'asset, network and deposit address are all required',
      );
    }

    const existing = await this.prisma.cryptoPaymentWatch.findUnique({ where: { orderId } });
    if (existing) return existing;

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const asset = method.cryptoAsset.toUpperCase();
    const network = method.cryptoNetwork.toUpperCase();
    const base = new Prisma.Decimal(order.total.toString()).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_UP,
    );
    const expiresAt = new Date(Date.now() + method.watchTtlMinutes * 60_000);

    for (let attempt = 0; attempt < ALLOCATION_ATTEMPTS; attempt++) {
      const units = 1 + Math.floor(Math.random() * MAX_DELTA_UNITS);
      const expectedAmount = base.add(DELTA_STEP.mul(units));

      try {
        const watch = await this.prisma.$transaction(async (tx) => {
          const created = await tx.cryptoPaymentWatch.create({
            data: {
              orderId,
              paymentMethodId: method.id,
              provider: method.provider,
              asset,
              network,
              address: method.depositAddress!,
              expectedAmount,
              expiresAt,
              claimKey: buildClaimKey(method.provider, asset, network, expectedAmount),
            },
          });

          await tx.orderEvent.create({
            data: {
              orderId,
              type: 'CRYPTO_WATCH_OPENED',
              actorType: 'SYSTEM',
              note: `Awaiting ${expectedAmount.toString()} ${asset} on ${network}`,
            },
          });

          return created;
        });

        return watch;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // The orderId collision means a concurrent request opened this
        // order's watch first — that one is just as good, so use it.
        if (uniqueViolationTargets(error, 'orderId')) {
          const concurrent = await this.prisma.cryptoPaymentWatch.findUnique({ where: { orderId } });
          if (concurrent) return concurrent;
        }
        // Otherwise the amount was taken; fall through and draw another.
      }
    }

    throw new AmountAllocationFailedError(orderId, ALLOCATION_ATTEMPTS);
  }

  /**
   * Releases watches past their deadline so their amounts return to the
   * pool. Only WAITING rows move, so a watch matched in the same instant
   * the sweep runs is left alone.
   */
  async expireStale(now = new Date()): Promise<number> {
    const stale = await this.prisma.cryptoPaymentWatch.findMany({
      where: { status: 'WAITING', expiresAt: { lt: now } },
      select: { id: true, orderId: true },
    });
    if (stale.length === 0) return 0;

    let expired = 0;
    for (const watch of stale) {
      const result = await this.prisma.cryptoPaymentWatch.updateMany({
        where: { id: watch.id, status: 'WAITING' },
        // Dropping the claim key is what frees the amount: NULLs don't
        // collide, so the next checkout may allocate it again.
        data: { status: 'EXPIRED', claimKey: null },
      });
      if (result.count === 0) continue;

      expired += 1;
      await this.prisma.orderEvent.create({
        data: {
          orderId: watch.orderId,
          type: 'CRYPTO_WATCH_EXPIRED',
          actorType: 'SYSTEM',
          note: 'Deposit window elapsed without a matching payment',
        },
      });

      // The order keeps its status, so `transition()` — which is what
      // normally messages the customer — never runs here. Without this the
      // only record of the window closing is an event row nobody reads,
      // and a customer who closed the Mini App learns nothing until they
      // open it again, possibly after paying to a dead window.
      await this.notifyExpired(watch.orderId);
    }

    if (expired > 0) this.logger.log(`Expired ${expired} crypto payment watch(es)`);
    return expired;
  }

  private async notifyExpired(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { customerId: true, sequenceNumber: true },
    });
    if (!order) return;

    const miniAppUrl = (this.config.get<string>('MINIAPP_URL') || 'http://localhost:3200').replace(
      /\/$/,
      '',
    );
    await this.notifications.notifyCustomer(order.customerId, {
      kind: 'crypto.watch_expired',
      orderId,
      summary:
        `⏰ انتهت مهلة الدفع لطلبك #${order.sequenceNumber}.\n` +
        'لو لسه عايز المنتج، اعمل الطلب من تاني. ولو كنت حوّلت المبلغ بالفعل، ' +
        'كلّم الدعم ومعاك رقم العملية وهنراجعه يدوياً.',
      button: { text: '📦 عرض الطلب', url: `${miniAppUrl}/orders/${orderId}` },
    });
  }

  /**
   * Pushes a waiting deadline out by another full window.
   *
   * A customer who is mid-transfer when the countdown runs out would
   * otherwise have to start a new order — and their in-flight payment
   * would land on a closed window and strand. Extending keeps the same
   * amount reserved, so money already sent still matches.
   *
   * Bounded: an abandoned page left open must not hold an amount out of
   * the pool indefinitely.
   */
  async extendForOrder(orderId: string, customerId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: { cryptoWatch: true, paymentMethod: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const watch = order.cryptoWatch;
    if (!watch) throw new NotFoundException('This order has no deposit window');
    if (watch.status !== 'WAITING') {
      throw new ConflictException('This deposit window is already closed');
    }
    if (watch.extensionsUsed >= MAX_EXTENSIONS) {
      throw new ConflictException(
        `A deposit window can be extended ${MAX_EXTENSIONS} times — please place a new order`,
      );
    }

    const minutes = order.paymentMethod?.watchTtlMinutes ?? 30;
    // From now rather than from the old deadline: extending a window that
    // lapsed seconds ago should still give a full one.
    const expiresAt = new Date(Date.now() + minutes * 60_000);

    // Guarded on WAITING and on the extension count we just read, so two
    // taps on the button cannot spend two extensions.
    const claimed = await this.prisma.cryptoPaymentWatch.updateMany({
      where: { id: watch.id, status: 'WAITING', extensionsUsed: watch.extensionsUsed },
      data: { expiresAt, extensionsUsed: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new ConflictException('That window changed while you were extending it — reload');
    }

    await this.prisma.orderEvent.create({
      data: {
        orderId,
        type: 'CRYPTO_WATCH_OPENED',
        actorType: 'CUSTOMER',
        actorCustomerId: customerId,
        note: `Deposit window extended by ${minutes} minutes (${watch.extensionsUsed + 1}/${MAX_EXTENSIONS})`,
      },
    });

    return this.findForOrder(orderId, customerId);
  }

  /**
   * Opens the watch on demand when the order has none yet. Checkout opens
   * it best-effort, so this is what recovers the customer who got through
   * checkout during an exchange hiccup: they open the payment page and the
   * watch appears, instead of an order nobody can pay.
   */
  async findForOrder(orderId: string, customerId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: { cryptoWatch: true, paymentMethod: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    let watch = order.cryptoWatch;
    if (!watch) {
      if (!order.paymentMethod || order.paymentMethod.provider === 'MANUAL') {
        throw new NotFoundException('This order is not paid with crypto');
      }
      watch = await this.openWatch(orderId, order.paymentMethod);
    }

    return {
      orderId: watch.orderId,
      provider: watch.provider,
      asset: watch.asset,
      network: watch.network,
      address: watch.address,
      amount: watch.expectedAmount.toString(),
      status: watch.status,
      expiresAt: watch.expiresAt,
      matchedAt: watch.matchedAt,
      extensionsUsed: watch.extensionsUsed,
      extensionsLeft: Math.max(0, MAX_EXTENSIONS - watch.extensionsUsed),
      /** False when the store has no key for this provider: nothing is
       *  actually watching, so the UI must not promise auto-confirmation. */
      autoConfirmActive: this.registry.isConfigured(watch.provider),
    };
  }

  async cancelForOrder(orderId: string): Promise<void> {
    await this.prisma.cryptoPaymentWatch.updateMany({
      where: { orderId, status: 'WAITING' },
      data: { status: 'CANCELLED', claimKey: null },
    });
  }

  /** Which providers have keys, for the admin connection panel. */
  providerStatus() {
    return (['BINANCE', 'BYBIT'] as const).map((provider) => ({
      provider,
      configured: this.registry.isConfigured(provider),
    }));
  }

  async listWatchesAdmin(status?: 'WAITING' | 'MATCHED' | 'EXPIRED' | 'CANCELLED') {
    const watches = await this.prisma.cryptoPaymentWatch.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        order: { select: { sequenceNumber: true, status: true, total: true, currency: true } },
      },
    });

    return watches.map((watch) => ({
      id: watch.id,
      orderId: watch.orderId,
      orderNumber: watch.order.sequenceNumber,
      orderStatus: watch.order.status,
      provider: watch.provider,
      asset: watch.asset,
      network: watch.network,
      address: watch.address,
      expectedAmount: watch.expectedAmount.toString(),
      orderTotal: watch.order.total.toString(),
      status: watch.status,
      expiresAt: watch.expiresAt,
      matchedAt: watch.matchedAt,
      createdAt: watch.createdAt,
    }));
  }

  /**
   * The deposit ledger. Rows with no order are deposits that matched no
   * watch — a customer who sent the wrong amount, or paid after their
   * window closed. They are the queue support actually works from.
   *
   * `suggestions` on an uncredited row is what turns that queue from a
   * wall of hex into something actionable: the orders whose expected
   * amount is within a hair of what arrived, nearest first.
   */
  async listDepositsAdmin(onlyUnmatched = false, nearMisses?: NearMissLookup) {
    const deposits = await this.prisma.cryptoDeposit.findMany({
      where: onlyUnmatched ? { creditedAt: null } : undefined,
      orderBy: { seenAt: 'desc' },
      take: 100,
    });

    const orderIds = deposits.map((d) => d.orderId).filter((id): id is string => Boolean(id));
    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, sequenceNumber: true },
        })
      : [];
    const orderNumbers = new Map(orders.map((o) => [o.id, o.sequenceNumber]));

    return Promise.all(
      deposits.map(async (deposit) => ({
        id: deposit.id,
        provider: deposit.provider,
        txId: deposit.txId,
        asset: deposit.asset,
        network: deposit.network,
        amount: deposit.amount.toString(),
        address: deposit.address,
        seenAt: deposit.seenAt,
        creditedAt: deposit.creditedAt,
        alertedAt: deposit.alertedAt,
        orderId: deposit.orderId,
        orderNumber: deposit.orderId ? (orderNumbers.get(deposit.orderId) ?? null) : null,
        matchedByStaffId: deposit.matchedByStaffId,
        // Only worth computing for money still looking for a home.
        suggestions: deposit.creditedAt || !nearMisses ? [] : await nearMisses(deposit),
      })),
    );
  }
}

/** Injected rather than imported, to keep this service free of the poller. */
export type NearMissLookup = (deposit: CryptoDeposit) => Promise<
  Array<{
    watchId: string;
    orderId: string;
    orderNumber: number;
    expectedAmount: string;
    difference: string;
  }>
>;

function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function uniqueViolationTargets(
  error: Prisma.PrismaClientKnownRequestError,
  field: string,
): boolean {
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  return typeof target === 'string' && target.includes(field);
}
