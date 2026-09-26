import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../queue/queue-names';
import type { DeliveryJobData } from './delivery.processor';

/**
 * Enqueues fulfillment for an order that just became PAID.
 *
 * Callers must invoke this *after* their transaction commits, never inside
 * it — a worker can pick the job up immediately, and an in-flight
 * transaction's PAID row would not be visible to it yet (or could roll
 * back entirely). The deterministic `jobId` makes a double-enqueue a no-op
 * at the queue level, on top of DeliveryService's own row-level guards.
 */
@Injectable()
export class DeliveryDispatcher {
  private readonly logger = new Logger(DeliveryDispatcher.name);

  constructor(@InjectQueue(QUEUE_NAMES.DELIVERY) private readonly queue: Queue<DeliveryJobData>) {}

  async dispatch(orderId: string): Promise<void> {
    try {
      await this.queue.add('fulfill-order', { orderId }, { jobId: `delivery-${orderId}` });
    } catch (err) {
      // A queue outage must not roll back an approved payment; the order
      // stays PAID and is picked up by the manual/admin fulfillment path.
      this.logger.error(
        `Failed to enqueue delivery for order ${orderId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
