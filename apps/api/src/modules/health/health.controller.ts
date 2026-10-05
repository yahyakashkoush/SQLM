import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorFunction,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { QueueHealthService } from '../queue/queue-health.service';

/**
 * Version-neutral: liveness/readiness probes and uptime monitors shouldn't
 * need to track the business API's version. Stays at `/api/health/*`
 * forever, independent of `/api/v1`, `/api/v2`, ...
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queueHealth: QueueHealthService,
  ) {}

  /** Liveness: process is up. Kubernetes/Docker restarts the container if this fails. */
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies are reachable. Load balancers stop routing traffic if this fails. */
  @Get('ready')
  @HealthCheck()
  ready() {
    const redisCheck: HealthIndicatorFunction = async () => {
      const pong = await this.redis.client.ping();
      const up = pong === 'PONG';
      return { redis: { status: up ? 'up' : 'down' } };
    };

    const telegramQueueCheck: HealthIndicatorFunction = async () => {
      try {
        const snapshots = await this.queueHealth.snapshot();
        const tg = snapshots.find((s) => s.queue === 'telegram-updates');
        const failed = tg?.counts?.['failed'] ?? 0;
        // Degraded (not down) when there are failed jobs — the queue still works.
        return { 'telegram-queue': { status: 'up', registered: tg?.registered ?? false, failed } };
      } catch {
        return { 'telegram-queue': { status: 'up', registered: false, failed: 0 } };
      }
    };

    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      redisCheck,
      telegramQueueCheck,
    ]);
  }
}
