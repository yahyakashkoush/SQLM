import { ConfigService } from '@nestjs/config';
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  AuditLogQueryDto,
  BroadcastNotificationDto,
  CreateStaffDto,
  CustomerQueryDto,
  UpdateSettingDto,
  UpdateStaffDto,
} from './dto/admin.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';

@Controller('admin')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly notifications: NotificationDispatcher,
    private readonly config: ConfigService,
  ) {}

  @Get('stats')
  @Permissions('analytics.read')
  stats() {
    return this.admin.stats();
  }

  @Get('customers')
  @Permissions('customers.read')
  listCustomers(@Query() query: CustomerQueryDto) {
    return this.admin.listCustomers(query);
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

  @Post('notifications/broadcast')
  @Permissions('settings.write')
  async broadcast(@Body() dto: BroadcastNotificationDto) {
    const miniAppUrl = this.config.get<string>('MINIAPP_URL', 'http://localhost:3200');
    const sent = await this.notifications.broadcastToAllCustomers({
      kind: 'broadcast',
      summary: dto.message,
      imageUrl: dto.imageUrl,
      button: dto.withStoreButton ? { text: '🛍️ افتح المتجر', url: miniAppUrl } : undefined,
    });
    return { sent };
  }
}
