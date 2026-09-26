import { Controller, Get, UseGuards } from '@nestjs/common';
import { ROLES, ROLE_PERMISSIONS } from '@sqlm/shared';
import { JwtStaffAuthGuard } from './guards/jwt-staff-auth.guard';
import { Permissions } from './decorators/permissions.decorator';
import { PermissionsGuard } from './guards/permissions.guard';

@Controller('rbac')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class RbacController {
  /** Powers the Admin Dashboard's /admin/roles page (Phase 11) — the permission matrix, read-only. */
  @Get('roles')
  @Permissions('roles.read')
  listRoles() {
    return ROLES.map((role) => ({ role, permissions: ROLE_PERMISSIONS[role] }));
  }
}
