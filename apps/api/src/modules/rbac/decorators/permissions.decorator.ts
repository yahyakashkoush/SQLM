import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@sqlm/shared';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares which permissions a route requires. Checked by `PermissionsGuard`
 * against the authenticated staff member's role via
 * `packages/shared`'s `ROLE_PERMISSIONS` map — never against the frontend,
 * and never against the role name directly, so custom roles can be added
 * later without touching guard code.
 */
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
