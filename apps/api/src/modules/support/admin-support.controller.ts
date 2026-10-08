import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SupportService } from './support.service';
import {
  AddTicketMessageDto,
  AssignTicketDto,
  SetTicketStatusDto,
  TicketQueryDto,
} from './dto/ticket.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';

@Controller('admin/support/tickets')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @Permissions('support.read')
  list(@Query() query: TicketQueryDto) {
    return this.support.listAdmin(query);
  }

  @Get('unread-count')
  @Permissions('support.read')
  unread(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.support.unreadCounts({ type: 'STAFF', staffId: staff.id });
  }

  @Get(':id')
  @Permissions('support.read')
  thread(@Param('id') id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.support.getThread(id, { type: 'STAFF', staffId: staff.id });
  }

  @Post(':id/messages')
  @Permissions('support.write')
  reply(
    @Param('id') id: string,
    @Body() dto: AddTicketMessageDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.support.addMessage(
      id,
      { type: 'STAFF', staffId: staff.id },
      dto.message,
      dto.internal ?? false,
    );
  }

  @Patch(':id/assign')
  @Permissions('support.write')
  assign(@Param('id') id: string, @Body() dto: AssignTicketDto) {
    return this.support.assign(id, dto.staffId ?? null);
  }

  @Patch(':id/status')
  @Permissions('support.write')
  setStatus(
    @Param('id') id: string,
    @Body() dto: SetTicketStatusDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.support.setStatus(id, dto.status, staff.id);
  }
}
