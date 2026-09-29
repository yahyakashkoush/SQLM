import { Injectable, Logger } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ModuleRef } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { Gauge } from 'prom-client';
import { MetricsService } from '../health/metrics.service';
import { QUEUE_NAMES } from './queue-names';

export interface QueueSnapshot {
  queue: string;
  counts: Record<string, number>;
  failedSamples: Array<{ id: string; name: string; reason: string; attempts: number }>;
  registered: boolean;
}

/**
 * Queue visibility for the dashboard and Prometheus.
 *
 * Queues are resolved lazily through ModuleRef rather than constructor
 * injection: only the queues whose owning module is loaded exist in the
 * container, and the API tier and worker tier load different subsets. A
 * missing queue is reported as `registered: false` instead of failing the
 * whole health call.
 */
@Injectable()
export class QueueHealthService {
  private readonly logger = new Logger(QueueHealthService.name);
  private readonly depthGauge: Gauge<'queue' | 'state'>;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly metrics: MetricsService,
  ) {
    this.depthGauge = new Gauge({
      name: 'queue_depth',
      help: 'Jobs per BullMQ queue by state',
      labelNames: ['queue', 'state'] as const,
      registers: [this.metrics.registry],
    });
  }

  private resolve(name: string): Queue | null {
    try {
      return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
    } catch {
      return null;
    }
  }

  async snapshot(): Promise<QueueSnapshot[]> {
    const results: QueueSnapshot[] = [];

    for (const name of Object.values(QUEUE_NAMES)) {
      const queue = this.resolve(name);
      if (!queue) {
        results.push({ queue: name, counts: {}, failedSamples: [], registered: false });
        continue;
      }

      try {
        const counts = await queue.getJobCounts();
        for (const [state, value] of Object.entries(counts)) {
          this.depthGauge.set({ queue: name, state }, value);
        }

        // A failed job's reason is the single most useful thing when
        // something is wrong, so surface a few rather than just a count.
        const failed = await queue.getFailed(0, 4);
        results.push({
          queue: name,
          counts,
          registered: true,
          failedSamples: failed.map((job) => ({
            id: String(job.id),
            name: job.name,
            reason: job.failedReason ?? 'unknown',
            attempts: job.attemptsMade,
          })),
        });
      } catch (err) {
        this.logger.warn(
          `Could not read queue ${name}: ${err instanceof Error ? err.message : err}`,
        );
        results.push({ queue: name, counts: {}, failedSamples: [], registered: false });
      }
    }

    return results;
  }

  /** Retries every failed job on a queue — the "we fixed the cause" button. */
  async retryFailed(name: string): Promise<{ retried: number }> {
    const queue = this.resolve(name);
    if (!queue) return { retried: 0 };

    const failed = await queue.getFailed(0, 100);
    for (const job of failed) await job.retry();
    return { retried: failed.length };
  }
}
