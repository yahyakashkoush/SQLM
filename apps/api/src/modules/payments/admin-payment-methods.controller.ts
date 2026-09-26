import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';

@Controller('admin/payment-methods')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminPaymentMethodsController {
  constructor(private readonly paymentMethods: PaymentMethodsService) {}

  @Get()
  @Permissions('payments.methods.read')
  list() {
    return this.paymentMethods.listAll();
  }

  @Get(':id')
  @Permissions('payments.methods.read')
  findById(@Param('id') id: string) {
    return this.paymentMethods.findById(id);
  }

  @Post()
  @Permissions('payments.methods.write')
  create(@Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethods.create(dto);
  }

  @Patch(':id')
  @Permissions('payments.methods.write')
  update(@Param('id') id: string, @Body() dto: UpdatePaymentMethodDto) {
    return this.paymentMethods.update(id, dto);
  }

  @Delete(':id')
  @Permissions('payments.methods.write')
  disable(@Param('id') id: string) {
    return this.paymentMethods.disable(id);
  }
}
