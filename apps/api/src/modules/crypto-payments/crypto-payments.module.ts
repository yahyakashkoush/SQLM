import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DepositPollerService } from './deposit-poller.service';
import { DepositPollerProcessor, DepositPollerScheduler } from './deposit-poller.processor';
import { CryptoPaymentsController } from './crypto-payments.controller';
import { AdminCryptoController } from './admin-crypto.controller';
import { OrdersModule } from '../orders/orders.module';
import { QUEUE_NAMES } from '../queue/queue-names';

/** The settlement side. CryptoWatchModule (global) supplies the rest. */
@Module({
  imports: [OrdersModule, BullModule.registerQueue({ name: QUEUE_NAMES.CRYPTO_DEPOSITS })],
  controllers: [CryptoPaymentsController, AdminCryptoController],
  providers: [DepositPollerService, DepositPollerProcessor, DepositPollerScheduler],
  exports: [DepositPollerService],
})
export class CryptoPaymentsModule {}
