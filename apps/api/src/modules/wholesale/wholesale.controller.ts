import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { WholesaleService } from './wholesale.service';
import { ApplyWholesaleDto, ReviewWholesaleDto, WholesaleListQueryDto } from './wholesale.dto';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import { CurrentCustomer, type AuthenticatedCustomer } from '../rbac/decorators/current-customer.decorator';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';

@Controller('wholesale')
@UseGuards(JwtCustomerAuthGuard)
export class WholesaleController {
  constructor(private readonly wholesale: WholesaleService) {}

  @Get()
  status(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.wholesale.statusFor(customer.id);
  }

  @Post('apply')
  apply(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: ApplyWholesaleDto) {
    return this.wholesale.apply(customer.id, dto);
  }

  @Get('catalog')
  catalog(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.wholesale.catalogFor(customer.id);
  }

  @Get('products/:productId/bundles')
  bundles(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.wholesale.bundlesFor(customer.id, productId);
  }
}

@Controller('admin/wholesale')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminWholesaleController {
  constructor(private readonly wholesale: WholesaleService) {}

  @Get()
  @Permissions('customers.read')
  list(@Query() query: WholesaleListQueryDto) {
    return this.wholesale.list(query.status);
  }

  @Post(':id/review')
  @Permissions('customers.write')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewWholesaleDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.wholesale.review(id, staff.id, dto.approve, dto.note);
  }

  @Post('customers/:customerId/revoke')
  @Permissions('customers.write')
  async revoke(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    await this.wholesale.revoke(customerId, staff.id);
    return { ok: true };
  }
}
