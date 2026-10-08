import { Controller, Sse, UseGuards } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { RealtimeService } from './realtime.service';
import type { NotificationJob } from './notification-dispatcher.service';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import {
  CurrentCustomer,
  type AuthenticatedCustomer,
} from '../rbac/decorators/current-customer.decorator';

@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /** Dashboard live feed: new orders, payment submissions, support replies, delivery/inventory alerts. */
  @Sse('staff')
  @UseGuards(JwtStaffAuthGuard, PermissionsGuard)
  @Permissions('orders.read')
  staff(): Observable<{ data: NotificationJob }> {
    return this.realtime.staffStream();
  }

  /** Mini App live feed, scoped to the authenticated customer only. */
  @Sse('me')
  @UseGuards(JwtCustomerAuthGuard)
  me(@CurrentCustomer() customer: AuthenticatedCustomer): Observable<{ data: NotificationJob }> {
    return this.realtime.customerStream(customer.id);
  }
}
