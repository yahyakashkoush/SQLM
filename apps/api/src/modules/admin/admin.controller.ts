import { ConfigService } from '@nestjs/config';
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  AuditLogQueryDto,
  BroadcastNotificationDto,
  CreateStaffDto,
  CustomerQueryDto,
  SetCustomerVerifiedDto,
  UpdateSettingDto,
  UpdateStaffDto,
  BanCustomerDto,
} from './dto/admin.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { segmentWhere } from '../customers/customer-segments';
import { CustomerModerationService } from '../orders/customer-moderation.service';

@Controller('admin')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly notifications: NotificationDispatcher,
    private readonly config: ConfigService,
    private readonly moderation: CustomerModerationService,
  ) {}

  @Get('stats')
  @Permissions('analytics.read')
  stats() {
    return this.admin.stats();
  }

  /** Revenue over a window with the previous one alongside, so the number
   *  on the dashboard answers "better or worse" and not just "how much". */
  @Get('revenue')
  @Permissions('analytics.read')
  revenue(@Query('days') days?: string) {
    return this.admin.revenueReport(days ? Number(days) : 30);
  }

  @Get('customers')
  @Permissions('customers.read')
  listCustomers(@Query() query: CustomerQueryDto) {
    return this.admin.listCustomers(query);
  }

  /** How many customers each audience reaches, for the broadcast picker
   *  and the customers-list filter. Declared before `customers/:id`,
   *  which would otherwise capture "segments" as an id. */
  @Get('customers/segments')
  @Permissions('customers.read')
  segments() {
    return this.admin.segmentCounts();
  }

  @Get('customers/:id')
  @Permissions('customers.read')
  getCustomer(@Param('id') id: string) {
    return this.admin.getCustomer(id);
  }

  @Get('staff')
  @Permissions('staff.read')
  listStaff() {
    return this.admin.listStaff();
  }

  @Post('staff')
  @Permissions('staff.write')
  createStaff(@Body() dto: CreateStaffDto, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.admin.createStaff(dto, staff.id);
  }

  @Patch('staff/:id')
  @Permissions('staff.write')
  updateStaff(
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.admin.updateStaff(id, dto, staff.id);
  }

  @Get('audit-logs')
  @Permissions('audit_logs.read')
  auditLogs(@Query() query: AuditLogQueryDto) {
    return this.admin.listAuditLogs(query);
  }

  @Get('settings')
  @Permissions('settings.read')
  settings() {
    return this.admin.listSettings();
  }

  @Patch('settings/:key')
  @Permissions('settings.write')
  updateSetting(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.admin.updateSetting(key, dto, staff.id);
  }

  /** Suspends the account and cancels every order it has not paid for. */
  @Post('customers/:id/ban')
  @Permissions('customers.ban')
  ban(@Param('id') id: string, @Body() dto: BanCustomerDto, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.moderation.ban(id, staff.id, dto.reason);
  }

  @Post('customers/:id/unban')
  @Permissions('customers.ban')
  async unban(@Param('id') id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    await this.moderation.unban(id, staff.id);
    return { ok: true };
  }

  /** Staff override of the automatic verified status. */
  @Patch('customers/:id/verification')
  @Permissions('customers.write')
  setVerified(
    @Param('id') id: string,
    @Body() dto: SetCustomerVerifiedDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.admin.setCustomerVerified(id, dto.verified, staff.id);
  }

  @Post('notifications/broadcast')
  @Permissions('settings.write')
  async broadcast(@Body() dto: BroadcastNotificationDto) {
    const miniAppUrl = this.config.get<string>('MINIAPP_URL', 'http://localhost:3200');
    const segment = dto.segment ?? 'ALL';
    const sent = await this.notifications.broadcastToCustomers(
      {
        kind: 'broadcast',
        summary: dto.message,
        imageUrl: dto.imageUrl,
        button: dto.withStoreButton ? { text: '🛍️ افتح المتجر', url: miniAppUrl } : undefined,
      },
      segmentWhere(segment),
    );
    return { sent, segment };
  }
}
