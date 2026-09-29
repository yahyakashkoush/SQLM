import { Module } from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { AdminPaymentMethodsController } from './admin-payment-methods.controller';
import { PaymentProofsService } from './payment-proofs.service';
import { PaymentProofsController } from './payment-proofs.controller';
import { AdminPaymentProofsController } from './admin-payment-proofs.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [
    PaymentMethodsController,
    AdminPaymentMethodsController,
    PaymentProofsController,
    AdminPaymentProofsController,
  ],
  providers: [PaymentMethodsService, PaymentProofsService],
  exports: [PaymentMethodsService, PaymentProofsService],
})
export class PaymentsModule {}
