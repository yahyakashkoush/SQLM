import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramUpdateProcessor } from './telegram-update.processor';
import { CustomersModule } from '../customers/customers.module';
import { OrdersModule } from '../orders/orders.module';
import { SupportModule } from '../support/support.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminBotController } from './admin-bot.controller';
import { StaffTelegramService } from './staff-telegram.service';
import { StaffAlertRenderer } from './staff-alert.renderer';
import { StaffNotifier } from './staff-notifier.service';
import { QUEUE_NAMES } from '../queue/queue-names';

/** Global so the notifications worker can push outbound messages (to
 *  customers, and staff alerts via StaffNotifier) without importing this
 *  module, which would close a cycle back through support. */
@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.TELEGRAM_UPDATES }),
    CustomersModule,
    OrdersModule,
    SupportModule,
    PaymentsModule,
  ],
  controllers: [TelegramWebhookController, AdminBotController],
  providers: [
    TelegramBotService,
    TelegramUpdateProcessor,
    StaffTelegramService,
    StaffAlertRenderer,
    StaffNotifier,
  ],
  exports: [TelegramBotService, StaffNotifier],
})
export class TelegramModule {}
