export const ROLES = [
  'OWNER',
  'ADMIN',
  'PAYMENT_REVIEWER',
  'SUPPORT_AGENT',
  'DELIVERY_AGENT',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Granular server-enforced permissions. Roles are just named bundles of
 * these (see `ROLE_PERMISSIONS` below and the RBAC seed in
 * packages/database/prisma/seed.ts) — every guard checks permissions, never
 * role names directly, so custom roles can be composed later without
 * touching guard code.
 */
export const PERMISSIONS = [
  'products.read',
  'products.write',
  'categories.read',
  'categories.write',
  'inventory.read',
  'inventory.write',
  'inventory.reveal_secret',
  'orders.read',
  'orders.write',
  'orders.transition',
  'payments.methods.read',
  'payments.methods.write',
  'payments.proofs.read',
  'payments.proofs.review',
  'delivery.read',
  'delivery.fulfill',
  'support.read',
  'support.write',
  'customers.read',
  'customers.write',
  'staff.read',
  'staff.write',
  'roles.read',
  'roles.write',
  'analytics.read',
  'settings.read',
  'settings.write',
  'audit_logs.read',
  'system_health.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: [
    'products.read',
    'products.write',
    'categories.read',
    'categories.write',
    'inventory.read',
    'inventory.write',
    'inventory.reveal_secret',
    'orders.read',
    'orders.write',
    'orders.transition',
    'payments.methods.read',
    'payments.methods.write',
    'payments.proofs.read',
    'payments.proofs.review',
    'delivery.read',
    'delivery.fulfill',
    'support.read',
    'support.write',
    'customers.read',
    'customers.write',
    'analytics.read',
    'settings.read',
    'audit_logs.read',
    'system_health.read',
  ],
  PAYMENT_REVIEWER: [
    'payments.proofs.read',
    'payments.proofs.review',
    'orders.read',
    'orders.transition',
    'customers.read',
  ],
  SUPPORT_AGENT: ['support.read', 'support.write', 'customers.read', 'orders.read'],
  DELIVERY_AGENT: [
    'orders.read',
    'orders.transition',
    'inventory.read',
    'inventory.write',
    'inventory.reveal_secret',
    'delivery.read',
    'delivery.fulfill',
  ],
};
