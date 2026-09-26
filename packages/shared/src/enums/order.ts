/**
 * Order lifecycle. This list is the single source of truth for allowed
 * states — it is mirrored 1:1 in the Prisma `OrderStatus` enum. The allowed
 * *transitions* between these states live in
 * `apps/api/src/modules/orders/order-state-machine.ts`, not here.
 */
export const ORDER_STATUSES = [
  'CREATED',
  'PENDING_PAYMENT',
  'PAYMENT_SUBMITTED',
  'PAYMENT_REVIEW',
  'PAID',
  'PROCESSING',
  'READY_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
  'DISPUTED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  CREATED: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['PAYMENT_SUBMITTED', 'CANCELLED'],
  PAYMENT_SUBMITTED: ['PAYMENT_REVIEW', 'CANCELLED'],
  PAYMENT_REVIEW: ['PAID', 'PENDING_PAYMENT', 'CANCELLED'],
  PAID: ['PROCESSING', 'REFUNDED', 'DISPUTED'],
  PROCESSING: ['READY_FOR_DELIVERY', 'DISPUTED'],
  READY_FOR_DELIVERY: ['DELIVERED', 'DISPUTED'],
  DELIVERED: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['DISPUTED', 'REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
  DISPUTED: ['REFUNDED', 'COMPLETED', 'CANCELLED'],
};

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];

export const ORDER_EVENT_TYPES = [
  'STATUS_CHANGED',
  'NOTE_ADDED',
  'PAYMENT_PROOF_UPLOADED',
  'PAYMENT_APPROVED',
  'PAYMENT_REJECTED',
  'INVENTORY_RESERVED',
  'INVENTORY_RELEASED',
  'DELIVERY_STARTED',
  'DELIVERY_COMPLETED',
  'DELIVERY_FAILED',
] as const;

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];
