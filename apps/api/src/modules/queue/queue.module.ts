import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueHealthService } from './queue-health.service';
import { QueueHealthController } from './queue-health.controller';
import { HealthModule } from '../health/health.module';

/**
 * Global BullMQ connection config. Feature modules (telegram, and — from
 * Phase 13 on — notifications/orders/delivery/support/...) register their
 * own named queues with `BullModule.registerQueue({ name: '...' })`; this
 * module only owns the shared Redis connection so every queue talks to the
 * same instance with the same (BullMQ-required) connection options.
 *
 * `maxRetriesPerRequest: null` is mandatory for BullMQ's blocking commands —
 * without it, ioredis's own retry logic fights BullMQ's, and jobs die with
 * cryptic connection errors under load.
 */
@Global()
@Module({
  imports: [
    HealthModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null,
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      }),
    }),
  ],
  controllers: [QueueHealthController],
  providers: [QueueHealthService],
  exports: [BullModule, QueueHealthService],
})
export class QueueModule {}
