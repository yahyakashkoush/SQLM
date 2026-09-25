import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DeliveryDispatcher } from './delivery-dispatcher.service';
import { QUEUE_NAMES } from '../queue/queue-names';

/**
 * Just the enqueue side of delivery, split out from DeliveryModule so that
 * modules which trigger fulfillment (orders, payments) can depend on it
 * without importing DeliveryModule — which imports OrdersModule and would
 * otherwise close a dependency cycle.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.DELIVERY })],
  providers: [DeliveryDispatcher],
  exports: [DeliveryDispatcher, BullModule],
})
export class DeliveryQueueModule {}
