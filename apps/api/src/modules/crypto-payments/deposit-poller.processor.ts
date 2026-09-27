import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import { DepositPollerService } from './deposit-poller.service';
import { ExchangeRegistry } from './exchange/exchange-registry.service';
import { QUEUE_NAMES } from '../queue/queue-names';

export type CryptoDepositJobName = 'poll-deposits';

@Processor(QUEUE_NAMES.CRYPTO_DEPOSITS)
export class DepositPollerProcessor extends WorkerHost {
  private readonly logger = new Logger(DepositPollerProcessor.name);

  constructor(private readonly poller: DepositPollerService) {
    super();
  }

  async process(job: Job<unknown, unknown, CryptoDepositJobName>): Promise<void> {
    if (job.name !== 'poll-deposits') {
      this.logger.warn(`Unknown crypto deposit job: ${String(job.name)}`);
      return;
    }

    const summary = await this.poller.pollOnce();
    if (summary.ingested > 0 || summary.settled > 0 || summary.expired > 0) {
      this.logger.log(
        `Deposit sweep: ${summary.ingested} new, ${summary.settled} settled, ${summary.expired} expired`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`Crypto deposit job ${job.name} failed: ${err.message}`);
  }
}

/**
 * Registers the sweep as a BullMQ repeatable job so N API replicas still
 * poll each exchange once — Redis owns the schedule, not the process.
 * Skipped entirely when no exchange key is configured, so a store on
 * manual payments alone never talks to an exchange.
 */
@Injectable()
export class DepositPollerScheduler implements OnModuleInit {
  private readonly logger = new Logger(DepositPollerScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.CRYPTO_DEPOSITS) private readonly queue: Queue,
    private readonly registry: ExchangeRegistry,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.registry.configured().length === 0) return;

    const every = this.config.get<number>('CRYPTO_POLL_INTERVAL_MS') ?? 40_000;
    try {
      await this.queue.add(
        'poll-deposits',
        {},
        { repeat: { every }, jobId: 'crypto-poll-deposits', removeOnComplete: 50, removeOnFail: 50 },
      );
      this.logger.log(`Deposit poller scheduled every ${every}ms`);
    } catch (err) {
      this.logger.error(
        `Could not register the deposit poller: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
