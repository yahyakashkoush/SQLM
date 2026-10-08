import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { WalletService } from './wallet.service';
import { AdjustWalletDto, CreateTopUpDto, ReviewTopUpDto, TopUpListQueryDto } from './wallet.dto';
import { MAX_PROOF_FILE_BYTES } from '../payments/payment-proofs.service';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import {
  CurrentCustomer,
  type AuthenticatedCustomer,
} from '../rbac/decorators/current-customer.decorator';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';

@Controller('wallet')
@UseGuards(JwtCustomerAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  summary(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.wallet.summary(customer.id);
  }

  @Get('topups')
  topUps(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.wallet.listTopUps(customer.id);
  }

  /** Each manual method with what a top-up of `amount` costs to transfer. */
  @Get('topup-quote')
  quote(@CurrentCustomer() customer: AuthenticatedCustomer, @Query('amount') amount?: string) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 1 || value > 100_000) {
      throw new BadRequestException('amount must be between 1 and 100000');
    }
    return this.wallet.topUpQuote(customer.id, Math.round(value * 100) / 100);
  }

  @Post('topups')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROOF_FILE_BYTES } }))
  createTopUp(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: CreateTopUpDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No receipt uploaded');
    return this.wallet.createTopUp(customer.id, dto, file);
  }

  @Post('pay/:orderId')
  pay(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.wallet.payOrder(customer.id, orderId);
  }
}

@Controller('admin/wallet')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('topups')
  @Permissions('payments.proofs.read')
  list(@Query() query: TopUpListQueryDto) {
    return this.wallet.adminList(query.status);
  }

  @Get('topups/:id/proof')
  @Permissions('payments.proofs.read')
  proof(@Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.proofUrl(id);
  }

  @Post('topups/:id/review')
  @Permissions('payments.proofs.review')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewTopUpDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.wallet.review(id, staff.id, dto);
  }

  @Get('customers/:customerId')
  @Permissions('customers.read')
  customerWallet(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.wallet.adminWallet(customerId);
  }

  @Post('customers/:customerId/adjust')
  @Permissions('wallet.adjust')
  adjust(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: AdjustWalletDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.wallet.adjust(customerId, staff.id, dto);
  }
}
