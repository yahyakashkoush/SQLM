import './common/bigint-json';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { StorageModule } from './modules/storage/storage.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { QueueModule } from './modules/queue/queue.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { DeliveryQueueModule } from './modules/delivery/delivery-queue.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SupportModule } from './modules/support/support.module';
import { AdminModule } from './modules/admin/admin.module';
import { CleanupModule } from './modules/cleanup/cleanup.module';
import { SettingsModule } from './modules/settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        autoLogging: true,
        // req.url carries ?access_token=... on the SSE routes (EventSource
        // cannot set headers), so it is redacted alongside the usual
        // credential headers — otherwise every log line would leak a
        // usable staff token.
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-telegram-bot-api-secret-token"]',
          'req.query.access_token',
          'req.url',
        ],
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    // Named profiles so `@Throttle({ auth: {} })` can apply a much
    // stricter, independently-configurable limit to brute-force-prone
    // routes (login, Telegram auth) without touching the global default.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: config.get<number>('RATE_LIMIT_WINDOW_MS', 60000),
          limit: config.get<number>('RATE_LIMIT_MAX', 120),
        },
        {
          name: 'auth',
          ttl: config.get<number>('AUTH_RATE_LIMIT_WINDOW_MS', 60000),
          limit: config.get<number>('AUTH_RATE_LIMIT_MAX', 5),
        },
      ],
    }),
    PrismaModule,
    SettingsModule,
    RedisModule,
    QueueModule,
    DeliveryQueueModule,
    HealthModule,
    CustomersModule,
    AuthModule,
    RbacModule,
    AuditModule,
    CatalogModule,
    InventoryModule,
    OrdersModule,
    StorageModule,
    PaymentsModule,
    TelegramModule,
    DeliveryModule,
    NotificationsModule,
    SupportModule,
    AdminModule,
    CleanupModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
