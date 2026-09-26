/**
 * Order lifecycle. This list is the single source of truth for allowed
 * states — it is mirrored 1:1 in the Prisma `OrderStatus` enum. The allowed
 * *transitions* between these states are
 * `ORDER_TRANSITIONS` below.
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

/** Customer-facing (Arabic) status names, shared by the bot, notifications and the Mini App. */
export const ORDER_STATUS_LABELS_AR: Record<OrderStatus, string> = {
  CREATED: 'تم الإنشاء',
  PENDING_PAYMENT: 'في انتظار الدفع',
  PAYMENT_SUBMITTED: 'تم إرسال إثبات الدفع',
  PAYMENT_REVIEW: 'جاري مراجعة الدفع',
  PAID: 'تم تأكيد الدفع',
  PROCESSING: 'جاري التجهيز',
  READY_FOR_DELIVERY: 'جاهز للتسليم',
  DELIVERED: 'تم التسليم',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغي',
  REFUNDED: 'تم الاسترداد',
  DISPUTED: 'قيد النزاع',
};
