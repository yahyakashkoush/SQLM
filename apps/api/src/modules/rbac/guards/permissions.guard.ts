import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@sqlm/shared';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthenticatedStaff } from '../decorators/current-staff.decorator';

/**
 * Must run after `JwtStaffAuthGuard` (which populates `request.staff`) —
 * order matters in `@UseGuards(JwtStaffAuthGuard, PermissionsGuard)`.
 * Checks the route's required permissions against the static
 * `ROLE_PERMISSIONS` map in packages/shared, never against the role name
 * directly, so authorization logic lives in exactly one place.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const staff: AuthenticatedStaff | undefined = request.staff;
    if (!staff) {
      throw new ForbiddenException('No authenticated staff on request');
    }

    const granted = ROLE_PERMISSIONS[staff.role as Role] ?? [];
    const missing = required.filter((permission) => !granted.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
    }
    return true;
  }
}
