import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { QueueHealthService } from './queue-health.service';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';

@Controller('admin/queues')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class QueueHealthController {
  constructor(private readonly queues: QueueHealthService) {}

  @Get()
  @Permissions('system_health.read')
  snapshot() {
    return this.queues.snapshot();
  }

  @Post(':name/retry-failed')
  @Permissions('system_health.read')
  retry(@Param('name') name: string) {
    return this.queues.retryFailed(name);
  }
}
