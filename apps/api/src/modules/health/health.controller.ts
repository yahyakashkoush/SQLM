import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorFunction,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

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

    return this.health.check([() => this.prismaIndicator.pingCheck('database', this.prisma), redisCheck]);
  }
}
