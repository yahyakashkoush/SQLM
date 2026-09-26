import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PaymentProofsService } from './payment-proofs.service';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import {
  CurrentCustomer,
  type AuthenticatedCustomer,
} from '../rbac/decorators/current-customer.decorator';

const MAX_PROOF_FILE_BYTES = 10 * 1024 * 1024;

@Controller('orders/:orderId/payment-proof')
@UseGuards(JwtCustomerAuthGuard)
export class PaymentProofsController {
  constructor(private readonly paymentProofs: PaymentProofsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROOF_FILE_BYTES } }))
  upload(
    @Param('orderId') orderId: string,
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.paymentProofs.uploadProof(orderId, customer.id, file);
  }

  @Get()
  list(@Param('orderId') orderId: string, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.paymentProofs.listForOrder(orderId, customer.id);
  }
}
