import { Injectable, Logger } from '@nestjs/common';
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
  errors: string[];
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
    const summary: PollSummary = { ingested: 0, settled: 0, expired: 0, errors: [] };

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
    return summary;
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

    const orderId = watch.orderId;

    const claimed = await this.prisma.$transaction(async (tx) => {
      // Claim the deposit first. Two workers racing on the same row leave
      // exactly one with count 1, so an order can never be paid twice by
      // one transaction id.
      const depositClaim = await tx.cryptoDeposit.updateMany({
        where: { id: deposit.id, creditedAt: null },
        data: { creditedAt: new Date(), watchId: watch.id, orderId },
      });
      if (depositClaim.count === 0) return false;

      // And the watch, so two different deposits of the same amount can't
      // both settle the one order — the second finds it no longer WAITING.
      const watchClaim = await tx.cryptoPaymentWatch.updateMany({
        where: { id: watch.id, status: 'WAITING' },
        data: { status: 'MATCHED', matchedAt: new Date(), claimKey: null },
      });
      if (watchClaim.count === 0) return false;

      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'CRYPTO_PAYMENT_DETECTED',
          actorType: 'SYSTEM',
          note: `${deposit.amount.toString()} ${deposit.asset} on ${deposit.network} — tx ${deposit.txId}`,
        },
      });

      // The manual path walks PENDING_PAYMENT → SUBMITTED → REVIEW → PAID
      // and so does this one. An on-chain deposit of the exact expected
      // amount is both the proof and its verification, but reusing the
      // path keeps one state machine for both and leaves the order's
      // history readable next to a manually reviewed one.
      await this.orders.transition(tx, orderId, 'PAYMENT_SUBMITTED', { type: 'SYSTEM' });
      await this.orders.transition(tx, orderId, 'PAYMENT_REVIEW', { type: 'SYSTEM' });
      await this.orders.transition(tx, orderId, 'PAID', { type: 'SYSTEM' });

      return true;
    });

    if (!claimed) return false;

    // After commit only: the delivery worker reads the order itself and
    // has to see the committed PAID row.
    await this.delivery.dispatch(orderId);
    await this.notifications.notifyStaff({
      kind: 'payment.reviewed',
      orderId,
      summary: `Crypto payment auto-confirmed for order ${orderId} (${deposit.amount.toString()} ${deposit.asset})`,
    });

    this.logger.log(
      `Auto-confirmed order ${orderId} from ${deposit.provider} deposit ${deposit.txId}`,
    );
    return true;
  }
}
