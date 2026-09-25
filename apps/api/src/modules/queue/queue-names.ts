/**
 * Central registry of queue names (spec §15). Each is registered by the
 * module that owns it — telegram-updates here in Phase 7, the rest as
 * their owning modules gain background processing (delivery in Phase 9,
 * notifications in Phase 12, the remainder in Phase 13).
 */
export const QUEUE_NAMES = {
  TELEGRAM_UPDATES: 'telegram-updates',
  NOTIFICATIONS: 'notifications',
  ORDERS: 'orders',
  PAYMENTS: 'payments',
  PAYMENT_REVIEW: 'payment-review',
  DELIVERY: 'delivery',
  SUPPORT: 'support',
  INVENTORY: 'inventory',
  CLEANUP: 'cleanup',
  ANALYTICS: 'analytics',
} as const;
