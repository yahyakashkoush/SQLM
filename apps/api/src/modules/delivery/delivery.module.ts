import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryProcessor } from './delivery.processor';
import { DeliveryController } from './delivery.controller';
import { AdminDeliveryController } from './admin-delivery.controller';
import { DeliveryTemplatesController } from './delivery-templates.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [DeliveryController, AdminDeliveryController, DeliveryTemplatesController],
  providers: [DeliveryService, DeliveryProcessor],
  exports: [DeliveryService],
})
export class DeliveryModule {}
