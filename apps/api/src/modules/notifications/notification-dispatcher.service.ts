import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../queue/queue-names';
import { RealtimeService } from './realtime.service';

export type NotificationKind =
  | 'order.created'
  | 'order.status_changed'
  | 'payment.submitted'
  | 'payment.reviewed'
  | 'delivery.completed'
  | 'delivery.failed'
  | 'inventory.low_stock'
  | 'support.ticket_created'
  | 'support.customer_reply'
  | 'support.staff_reply'
  | 'support.ticket_closed';

export interface NotificationPayload {
  kind: NotificationKind;
  summary: string;
  body?: string;
  orderId?: string;
  ticketId?: string;
  productId?: string;
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
  ) {}

  async notifyStaff(payload: NotificationPayload): Promise<void> {
    this.realtime.publishToStaff({ ...payload, audience: 'STAFF' });
    await this.enqueue({ ...payload, audience: 'STAFF' });
  }

  async notifyCustomer(customerId: string, payload: NotificationPayload): Promise<void> {
    this.realtime.publishToCustomer(customerId, { ...payload, audience: 'CUSTOMER', customerId });
    await this.enqueue({ ...payload, audience: 'CUSTOMER', customerId });
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
