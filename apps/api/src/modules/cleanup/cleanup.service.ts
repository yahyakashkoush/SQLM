import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';

const DEFAULT_ORDER_TTL_MINUTES = 60 * 24;

/**
 * Reclaims inventory that abandoned checkouts are sitting on.
 *
 * An order stuck in PENDING_PAYMENT holds a reservation forever otherwise,
 * so a handful of never-paid carts can make a product look sold out. The
 * cancellation goes through `OrdersService.transition()` like any other, so
 * inventory release, the order event, and the customer notification all
 * happen through the one audited code path instead of a bespoke cleanup
 * mutation that could drift from it.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly orders: OrdersService,
  ) {}

  private get ttlMinutes(): number {
    return this.config.get<number>('ORDER_EXPIRY_MINUTES', DEFAULT_ORDER_TTL_MINUTES);
  }

  async expireStaleOrders(): Promise<{ expired: number }> {
    const cutoff = new Date(Date.now() - this.ttlMinutes * 60 * 1000);

    const stale = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } },
      select: { id: true },
      take: 200,
    });

    let expired = 0;
    for (const order of stale) {
      try {
        await this.orders.transitionStandalone(
          order.id,
          'CANCELLED',
          { type: 'SYSTEM' },
          `Expired automatically after ${this.ttlMinutes} minutes without payment`,
        );
        expired += 1;
      } catch (err) {
        // A concurrent payment may have moved it on between the query and
        // the transition — that is the state machine doing its job, not a
        // cleanup failure worth retrying the whole batch for.
        this.logger.warn(
          `Skipped expiring order ${order.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    if (expired > 0) this.logger.log(`Expired ${expired} stale order(s), inventory released`);
    return { expired };
  }

  /** Trims delivered/failed payment proofs' orphaned rows and old telegram update logs. */
  async pruneTelegramUpdateLog(olderThanDays = 30): Promise<{ deleted: number }> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.telegramUpdateLog.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });
    if (count > 0) this.logger.log(`Pruned ${count} telegram update log row(s)`);
    return { deleted: count };
  }
}
