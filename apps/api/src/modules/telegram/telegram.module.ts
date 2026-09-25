import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramUpdateProcessor } from './telegram-update.processor';
import { CustomersModule } from '../customers/customers.module';
import { OrdersModule } from '../orders/orders.module';
import { QUEUE_NAMES } from '../queue/queue-names';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.TELEGRAM_UPDATES }), CustomersModule, OrdersModule],
  controllers: [TelegramWebhookController],
  providers: [TelegramBotService, TelegramUpdateProcessor],
  exports: [TelegramBotService],
})
export class TelegramModule {}
