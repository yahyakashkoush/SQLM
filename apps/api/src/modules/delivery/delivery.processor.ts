import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DeliveryService } from './delivery.service';
import { QUEUE_NAMES } from '../queue/queue-names';

export interface DeliveryJobData {
  orderId: string;
}

/**
 * Consumes the `delivery` queue. Retries/backoff come from the queue's
 * default job options; safety under retry comes from DeliveryService
 * itself, which is idempotent at the row level — a re-run after a partial
 * failure picks up only what is still PENDING and never re-delivers an
 * inventory item that already went out.
 */
@Processor(QUEUE_NAMES.DELIVERY)
export class DeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(DeliveryProcessor.name);

  constructor(private readonly delivery: DeliveryService) {
    super();
  }

  async process(job: Job<DeliveryJobData>): Promise<void> {
    const { orderId } = job.data;
    const result = await this.delivery.fulfillOrder(orderId);
    this.logger.log(
      `Fulfilled order ${orderId}: ${result.delivered} delivered, ${result.manual} awaiting manual handling`,
    );
  }
}
