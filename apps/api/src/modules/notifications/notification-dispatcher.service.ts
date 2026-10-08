import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { QUEUE_NAMES } from '../queue/queue-names';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

export type NotificationKind =
  | 'order.created'
  | 'order.status_changed'
  | 'payment.submitted'
  | 'payment.reviewed'
  /** Money arrived on-chain that matched no order — staff must resolve it. */
  | 'crypto.deposit_unmatched'
  /** A customer's deposit window closed without a payment. */
  | 'crypto.watch_expired'
  | 'delivery.completed'
  | 'delivery.failed'
  | 'inventory.low_stock'
  | 'support.ticket_created'
  | 'support.customer_reply'
  | 'support.staff_reply'
  | 'support.ticket_closed'
  /** A customer's first paid order made them verified. */
  | 'customer.verified'
  | 'broadcast'
  | 'product.new'
  /** A one-off message staff wrote to this customer. */
  | 'customer.message'
  /** The customer was suspended or banned (to them) — strike ladder or staff. */
  | 'customer.restricted'
  /** Staff: a strike was recorded. */
  | 'customer.strike'
  | 'appeal.created'
  | 'appeal.reviewed'
  | 'wholesale.applied'
  | 'wholesale.reviewed'
  /** Staff: a merchant asked to top up their wallet. */
  | 'wallet.topup_requested'
  /** Customer: their top-up was approved or rejected. */
  | 'wallet.topup_reviewed'
  /** Customer: staff credited or debited their wallet by hand. */
  | 'wallet.adjusted';

export interface NotificationPayload {
  kind: NotificationKind;
  summary: string;
  body?: string;
  orderId?: string;
  ticketId?: string;
  productId?: string;
  /** Delivered-item notifications render the credentials at send time from this row, so they never sit in Redis. */
  deliveryId?: string;
  imageUrl?: string;
  button?: { text: string; url: string };
  /** Realtime only — no Telegram push (for intermediate states the customer doesn't need a message about). */
  silent?: boolean;
  [key: string]: unknown;
}

export interface NotificationJob extends NotificationPayload {
  audience: 'STAFF' | 'CUSTOMER';
  customerId?: string;
}

/**
 * The one way anything in this codebase announces something happened.
 *
 * Two legs, deliberately: the in-process realtime stream (SSE, instant, for
 * dashboards that are open right now) and the notifications queue (durable,
 * retried, for Telegram pushes). A failure on either leg is logged and
 * swallowed — an undeliverable notification must never roll back the
 * business transaction that produced it.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly queue: Queue<NotificationJob>,
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  async notifyStaff(payload: NotificationPayload): Promise<void> {
    this.realtime.publishToStaff({ ...payload, audience: 'STAFF' });
    await this.enqueue({ ...payload, audience: 'STAFF' });
  }

  async notifyCustomer(customerId: string, payload: NotificationPayload): Promise<void> {
    this.realtime.publishToCustomer(customerId, { ...payload, audience: 'CUSTOMER', customerId });
    if (payload.silent) return;
    await this.enqueue({ ...payload, audience: 'CUSTOMER', customerId });
    // Persist to the in-app notification inbox (best-effort, never fails the caller).
    this.prisma.customerNotification
      .create({
        data: {
          customerId,
          kind: payload.kind,
          title: payload.summary.slice(0, 200),
          body: payload.body ?? payload.summary,
          metadata: payload as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((err) => this.logger.error(`Failed to persist customer notification: ${err instanceof Error ? err.message : err}`));
  }

  /** `where` picks the audience — see `segmentWhere`. Defaults to every active customer. */
  async broadcastToCustomers(
    payload: NotificationPayload,
    where: Prisma.CustomerWhereInput = { status: 'ACTIVE' },
  ): Promise<number> {
    const customers = await this.prisma.customer.findMany({
      where,
      select: { id: true },
    });
    const jobs = customers.map((c) => ({
      name: payload.kind,
      data: { ...payload, audience: 'CUSTOMER' as const, customerId: c.id },
    }));
    for (let i = 0; i < jobs.length; i += 500) {
      await this.queue.addBulk(jobs.slice(i, i + 500));
    }
    this.logger.log(`Broadcast "${payload.kind}" to ${jobs.length} customers`);
    return jobs.length;
  }

  private async enqueue(job: NotificationJob): Promise<void> {
    try {
      await this.queue.add(job.kind, job);
    } catch (err) {
      this.logger.error(
        `Failed to enqueue ${job.kind} notification: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
