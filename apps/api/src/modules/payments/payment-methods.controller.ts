import { Controller, Get } from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethods: PaymentMethodsService) {}

  @Get()
  list() {
    return this.paymentMethods.listEnabled();
  }
}
