import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { CleanupService } from './cleanup.service';
import { QUEUE_NAMES } from '../queue/queue-names';

export type CleanupJobName = 'expire-orders' | 'prune-telegram-log';

/**
 * The only scheduled work in the platform. Registered as BullMQ repeatable
 * jobs rather than an in-process cron so that N worker replicas still run
 * each sweep once — Redis owns the schedule, not the process.
 */
@Processor(QUEUE_NAMES.CLEANUP)
export class CleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(CleanupProcessor.name);

  constructor(private readonly cleanup: CleanupService) {
    super();
  }

  async process(job: Job<unknown, unknown, CleanupJobName>): Promise<void> {
    switch (job.name) {
      case 'expire-orders':
        await this.cleanup.expireStaleOrders();
        break;
      case 'prune-telegram-log':
        await this.cleanup.pruneTelegramUpdateLog();
        break;
      default:
        this.logger.warn(`Unknown cleanup job: ${String(job.name)}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`Cleanup job ${job.name} failed: ${err.message}`);
  }
}

@Injectable()
export class CleanupScheduler implements OnModuleInit {
  private readonly logger = new Logger(CleanupScheduler.name);

  constructor(@InjectQueue(QUEUE_NAMES.CLEANUP) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      // Deterministic jobIds: re-registering on every boot replaces the
      // schedule instead of stacking a duplicate per replica.
      await this.queue.add(
        'expire-orders',
        {},
        { repeat: { pattern: '*/15 * * * *' }, jobId: 'cleanup-expire-orders' },
      );
      await this.queue.add(
        'prune-telegram-log',
        {},
        { repeat: { pattern: '30 3 * * *' }, jobId: 'cleanup-prune-telegram-log' },
      );
    } catch (err) {
      this.logger.error(
        `Could not register cleanup schedules: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
