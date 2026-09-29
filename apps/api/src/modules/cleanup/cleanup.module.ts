import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CleanupService } from './cleanup.service';
import { CleanupProcessor, CleanupScheduler } from './cleanup.processor';
import { OrdersModule } from '../orders/orders.module';
import { QUEUE_NAMES } from '../queue/queue-names';

@Module({
  imports: [OrdersModule, BullModule.registerQueue({ name: QUEUE_NAMES.CLEANUP })],
  providers: [CleanupService, CleanupProcessor, CleanupScheduler],
  exports: [CleanupService],
})
export class CleanupModule {}
