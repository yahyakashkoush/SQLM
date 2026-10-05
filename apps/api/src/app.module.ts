import './common/bigint-json';
import { Module, type ExecutionContext } from '@nestjs/common';
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
import { CouponsModule } from './modules/coupons/coupons.module';
import { SupportModule } from './modules/support/support.module';
import { AdminModule } from './modules/admin/admin.module';
import { CleanupModule } from './modules/cleanup/cleanup.module';
import { CryptoWatchModule } from './modules/crypto-payments/crypto-watch.module';
import { CryptoPaymentsModule } from './modules/crypto-payments/crypto-payments.module';
import { SettingsModule } from './modules/settings/settings.module';
import { GiftsModule } from './modules/gifts/gifts.module';

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
          // Every named profile is evaluated on every route: `@Throttle({
          // auth: {} })` on the login handlers overrides this profile's
          // numbers there, it does not scope the profile to them. Without
          // this guard the 5-per-minute brute-force budget applied to the
          // whole API, so any client making a 6th call of any kind within
          // a minute got a 429.
          skipIf: (context) => !isBruteForceTarget(context),
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
    CouponsModule,
    SupportModule,
    AdminModule,
    CleanupModule,
    CryptoWatchModule,
    CryptoPaymentsModule,
    GiftsModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

/**
 * The credential-guessing surface: the only endpoints that accept a secret
 * and answer whether it was right. Matched on the path's tail so the global
 * prefix and API version can change without silently widening the limit.
 */
const BRUTE_FORCE_ROUTES = [/\/auth\/staff\/login$/, /\/auth\/telegram$/];

function isBruteForceTarget(context: ExecutionContext): boolean {
  if (context.getType() !== 'http') return false;
  const request = context.switchToHttp().getRequest<{ method?: string; path?: string; url?: string }>();
  if (request.method !== 'POST') return false;
  const path = (request.path ?? request.url ?? '').split('?')[0] ?? '';
  return BRUTE_FORCE_ROUTES.some((route) => route.test(path));
}
