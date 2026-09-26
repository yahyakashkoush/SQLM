import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CustomerAuthService } from './customer-auth.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import {
  CurrentCustomer,
  type AuthenticatedCustomer,
} from '../rbac/decorators/current-customer.decorator';

@Controller('auth/telegram')
export class CustomerAuthController {
  constructor(private readonly customerAuth: CustomerAuthService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: {} })
  authenticate(@Body() dto: TelegramAuthDto) {
    return this.customerAuth.authenticateWithTelegram(dto.initData);
  }

  @Get('me')
  @UseGuards(JwtCustomerAuthGuard)
  me(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return customer;
  }
}
