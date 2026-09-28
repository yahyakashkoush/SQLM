import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type CryptoDeposit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { DeliveryDispatcher } from '../delivery/delivery-dispatcher.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { ExchangeRegistry } from './exchange/exchange-registry.service';
import { CryptoWatchService } from './crypto-watch.service';
import type { ExchangeDeposit, ExchangeProvider } from './exchange/exchange-client';

export interface PollSummary {
  ingested: number;
  settled: number;
  expired: number;
  alerted: number;
  errors: string[];
}

/**
 * How long a deposit may sit unmatched before staff are told. Long enough
 * that a payment arriving a few seconds before its watch opens settles on
 * its own and never alerts; short enough that a customer who mistyped the
 * amount is not waiting on someone noticing.
 */
const STRANDED_AFTER_MS = 10 * 60_000;

/**
 * How far an amount may be off and still be offered as the same customer.
 * A deposit is a near miss when it is within this fraction of what a watch
 * expects — a mistyped last digit or a network fee shaved off the top, not
 * a different order that happens to cost roughly the same.
 */
const NEAR_MISS_TOLERANCE = 0.01;

export interface NearMiss {
  watchId: string;
  orderId: string;
  orderNumber: number;
  expectedAmount: string;
  /** Signed: positive when the customer sent more than asked. */
  difference: string;
}

/**
 * Turns exchange deposits into paid orders.
 *
 * Split into ingest and settle on purpose. Ingest writes every deposit to
 * the ledger, where the (provider, txId) unique index makes a repeat
 * sighting a no-op. Settle then works from the ledger — not from the API
 * response — over everything still uncredited, so a crash between the two
 * heals on the next sweep instead of stranding a real payment.
 */
@Injectable()
export class DepositPollerService {
  private readonly logger = new Logger(DepositPollerService.name);
  private readonly lookbackMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly registry: ExchangeRegistry,
    private readonly watches: CryptoWatchService,
    private readonly orders: OrdersService,
    private readonly delivery: DeliveryDispatcher,
    private readonly notifications: NotificationDispatcher,
  ) {
    this.lookbackMinutes = this.config.get<number>('CRYPTO_DEPOSIT_LOOKBACK_MINUTES') ?? 360;
  }

  async pollOnce(): Promise<PollSummary> {
    const summary: PollSummary = { ingested: 0, settled: 0, expired: 0, alerted: 0, errors: [] };

    for (const client of this.registry.configured()) {
      try {
        const since = new Date(Date.now() - this.lookbackMinutes * 60_000);
        const deposits = await client.listDeposits(since);
        summary.ingested += await this.ingest(client.provider, deposits);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // One unreachable exchange must not stop the other from settling,
        // nor stop the expiry sweep below.
        this.logger.error(`Deposit poll failed: ${message}`);
        summary.errors.push(message);
      }
    }

    summary.settled = await this.settlePending();
    summary.expired = await this.watches.expireStale();
    // After settling, so a deposit that just paid an order is never
    // reported as stranded.
    summary.alerted = await this.alertStranded();
    return summary;
  }

  /**
   * Tells staff about money that arrived and paid for nothing.
   *
   * Without this the ledger is a queue nobody is watching: a customer who
   * sends the wrong amount, or pays after their window closed, has really
   * transferred funds, and the only symptom is an order that stays unpaid
   * until they complain. Each deposit alerts once — `alertedAt` is what
   * stops the 40-second sweep repeating it forever.
   */
  private async alertStranded(): Promise<number> {
    const cutoff = new Date(Date.now() - STRANDED_AFTER_MS);
    const stranded = await this.prisma.cryptoDeposit.findMany({
      where: { creditedAt: null, alertedAt: null, seenAt: { lt: cutoff } },
      orderBy: { seenAt: 'asc' },
      take: 50,
    });
    if (stranded.length === 0) return 0;

    let alerted = 0;
    for (const deposit of stranded) {
      // Claim before notifying: if the notification throws, the row still
      // counts as alerted rather than re-alerting on every later sweep.
      const claim = await this.prisma.cryptoDeposit.updateMany({
        where: { id: deposit.id, alertedAt: null, creditedAt: null },
        data: { alertedAt: new Date() },
      });
      if (claim.count === 0) continue;
      alerted += 1;

      const [closest] = await this.findNearMisses(deposit);
      const suggestion = closest
        ? ` Closest order: #${closest.orderNumber} expecting ${closest.expectedAmount} (off by ${closest.difference}).`
        : ' No order is close to this amount.';

      await this.notifications.notifyStaff({
        kind: 'crypto.deposit_unmatched',
        summary:
          `⚠️ ${deposit.amount.toString()} ${deposit.asset} arrived on ${deposit.network} ` +
          `and matched no order.${suggestion}`,
        body: `tx ${deposit.txId} (${deposit.provider})`,
      });

      this.logger.warn(
        `Unmatched deposit ${deposit.provider}:${deposit.txId} — ${deposit.amount.toString()} ${deposit.asset}`,
      );
    }

    return alerted;
  }

  /**
   * Watches whose expected amount is within tolerance of what actually
   * arrived, nearest first.
   *
   * EXPIRED watches are included deliberately: the customer who paid late
   * is the single most common stranded deposit, and their watch is by
   * definition no longer WAITING. Nothing here credits anything — it only
   * gives whoever reads the alert a name to check.
   */
  async findNearMisses(deposit: CryptoDeposit): Promise<NearMiss[]> {
    const amount = deposit.amount;
    const tolerance = amount.mul(NEAR_MISS_TOLERANCE);

    const candidates = await this.prisma.cryptoPaymentWatch.findMany({
      where: {
        provider: deposit.provider,
        asset: deposit.asset,
        network: deposit.network,
        status: { in: ['WAITING', 'EXPIRED'] },
        expectedAmount: { gte: amount.sub(tolerance), lte: amount.add(tolerance) },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { order: { select: { sequenceNumber: true, status: true } } },
    });

    return candidates
      .map((watch) => ({
        watchId: watch.id,
        orderId: watch.orderId,
        orderNumber: watch.order.sequenceNumber,
        expectedAmount: watch.expectedAmount.toString(),
        difference: amount.sub(watch.expectedAmount).toString(),
        distance: amount.sub(watch.expectedAmount).abs(),
      }))
      .sort((a, b) => a.distance.comparedTo(b.distance))
      .map(({ distance: _distance, ...rest }) => rest);
  }

  /**
   * Writes unseen deposits to the ledger. Returns how many were new.
   *
   * `skipDuplicates` rather than catching the unique violation per row:
   * the lookback window re-reports every deposit on every sweep, so
   * collisions are the steady state, and letting them surface as errors
   * would bury real failures under thousands of expected ones.
   */
  private async ingest(
    provider: ExchangeProvider,
    deposits: ExchangeDeposit[],
  ): Promise<number> {
    if (deposits.length === 0) return 0;

    const { count } = await this.prisma.cryptoDeposit.createMany({
      data: deposits.map((deposit) => ({
        provider,
        txId: deposit.txId,
        asset: deposit.asset,
        network: deposit.network,
        amount: new Prisma.Decimal(deposit.amount),
        address: deposit.address,
        rawStatus: deposit.rawStatus,
      })),
      skipDuplicates: true,
    });

    return count;
  }

  /**
   * Credits every uncredited deposit that matches a waiting watch.
   *
   * Deposits with no match are left uncredited and retried each sweep —
   * that covers a customer who pays before the watch is open, and a
   * wrong-amount payment that support later resolves by hand.
   */
  private async settlePending(): Promise<number> {
    const pending = await this.prisma.cryptoDeposit.findMany({
      where: { creditedAt: null },
      orderBy: { seenAt: 'asc' },
      take: 200,
    });

    let settled = 0;
    for (const deposit of pending) {
      try {
        if (await this.settleOne(deposit)) settled += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to settle deposit ${deposit.provider}:${deposit.txId}: ${message}`);
      }
    }

    return settled;
  }

  private async settleOne(deposit: CryptoDeposit): Promise<boolean> {
    const watch = await this.prisma.cryptoPaymentWatch.findFirst({
      where: {
        status: 'WAITING',
        provider: deposit.provider,
        asset: deposit.asset,
        network: deposit.network,
        expectedAmount: deposit.amount,
      },
    });
    if (!watch) return false;

    const credited = await this.credit(deposit, {
      orderId: watch.orderId,
      watchId: watch.id,
      requireWatchWaiting: true,
      note: `${deposit.amount.toString()} ${deposit.asset} on ${deposit.network} — tx ${deposit.txId}`,
    });
    if (!credited) return false;

    await this.notifications.notifyStaff({
      kind: 'payment.reviewed',
      orderId: watch.orderId,
      summary: `Crypto payment auto-confirmed for order ${watch.orderId} (${deposit.amount.toString()} ${deposit.asset})`,
    });
    this.logger.log(
      `Auto-confirmed order ${watch.orderId} from ${deposit.provider} deposit ${deposit.txId}`,
    );
    return true;
  }

  /**
   * Credits a deposit against an order the operator picked, for money the
   * matcher could never claim on its own — a wrong amount, or a payment
   * that landed after the window closed.
   *
   * Deliberately the same `credit` path the automatic matcher uses, so a
   * hand-resolved payment reaches PAID through the same state machine,
   * dispatches delivery the same way, and leaves the same order history.
   * The only difference is who is recorded as having done it.
   */
  async matchManually(depositId: string, orderId: string, staffId: string): Promise<void> {
    const deposit = await this.prisma.cryptoDeposit.findUnique({ where: { id: depositId } });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.creditedAt) {
      throw new ConflictException('That deposit has already been credited');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { cryptoWatch: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!CREDITABLE_ORDER_STATUSES.includes(order.status)) {
      throw new ConflictException(
        `Order is ${order.status} — only an order still awaiting payment can be credited`,
      );
    }

    const credited = await this.credit(deposit, {
      orderId,
      watchId: order.cryptoWatch?.id ?? null,
      // The watch is typically EXPIRED here; that is the whole point.
      requireWatchWaiting: false,
      note:
        `Matched by hand: ${deposit.amount.toString()} ${deposit.asset} on ${deposit.network} ` +
        `— tx ${deposit.txId}`,
      staffId,
    });
    if (!credited) {
      throw new ConflictException('That deposit was credited by someone else just now');
    }

    await this.notifications.notifyStaff({
      kind: 'payment.reviewed',
      orderId,
      summary: `Crypto deposit matched by hand to order ${orderId} (${deposit.amount.toString()} ${deposit.asset})`,
    });
    this.logger.log(`Deposit ${deposit.provider}:${deposit.txId} matched to order ${orderId} by staff ${staffId}`);
  }

  /**
   * The one place a deposit turns into a paid order.
   *
   * Claims the deposit row first: two workers racing on it leave exactly
   * one with count 1, so a transaction id can never pay for two orders.
   */
  private async credit(
    deposit: CryptoDeposit,
    opts: {
      orderId: string;
      watchId: string | null;
      requireWatchWaiting: boolean;
      note: string;
      staffId?: string;
    },
  ): Promise<boolean> {
    const { orderId, watchId, requireWatchWaiting, note, staffId } = opts;

    const claimed = await this.prisma.$transaction(async (tx) => {
      const depositClaim = await tx.cryptoDeposit.updateMany({
        where: { id: deposit.id, creditedAt: null },
        data: {
          creditedAt: new Date(),
          watchId,
          orderId,
          ...(staffId ? { matchedByStaffId: staffId } : {}),
        },
      });
      if (depositClaim.count === 0) return false;

      if (watchId) {
        // Guarding on WAITING is what stops two deposits of the same
        // amount both settling one order; a hand-matched deposit has
        // nothing to race with, so it may claim an expired watch too.
        const watchClaim = await tx.cryptoPaymentWatch.updateMany({
          where: {
            id: watchId,
            ...(requireWatchWaiting ? { status: 'WAITING' } : { status: { not: 'MATCHED' } }),
          },
          data: { status: 'MATCHED', matchedAt: new Date(), claimKey: null },
        });
        if (watchClaim.count === 0) return false;
      }

      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'CRYPTO_PAYMENT_DETECTED',
          actorType: staffId ? 'STAFF' : 'SYSTEM',
          actorStaffId: staffId,
          note,
        },
      });

      // The manual path walks PENDING_PAYMENT → SUBMITTED → REVIEW → PAID
      // and so does this one. An on-chain deposit of the exact expected
      // amount is both the proof and its verification, but reusing the
      // path keeps one state machine for both and leaves the order's
      // history readable next to a manually reviewed one.
      const actor = staffId ? ({ type: 'STAFF', staffId } as const) : ({ type: 'SYSTEM' } as const);
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status === 'PENDING_PAYMENT' || order.status === 'CREATED') {
        if (order.status === 'CREATED') {
          await this.orders.transition(tx, orderId, 'PENDING_PAYMENT', actor);
        }
        await this.orders.transition(tx, orderId, 'PAYMENT_SUBMITTED', actor);
      }
      const afterSubmit = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (afterSubmit.status === 'PAYMENT_SUBMITTED') {
        await this.orders.transition(tx, orderId, 'PAYMENT_REVIEW', actor);
      }
      await this.orders.transition(tx, orderId, 'PAID', actor);

      return true;
    });

    if (!claimed) return false;

    // After commit only: the delivery worker reads the order itself and
    // has to see the committed PAID row.
    await this.delivery.dispatch(orderId);
    return true;
  }
}

/**
 * Statuses a deposit may still be credited against. Past PAID the order
 * already has its money, and crediting again would double-deliver.
 */
const CREDITABLE_ORDER_STATUSES: string[] = [
  'CREATED',
  'PENDING_PAYMENT',
  'PAYMENT_SUBMITTED',
  'PAYMENT_REVIEW',
];
