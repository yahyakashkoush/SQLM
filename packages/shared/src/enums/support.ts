export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'WAITING_ADMIN',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_MESSAGE_AUTHOR_TYPES = ['CUSTOMER', 'STAFF', 'SYSTEM'] as const;
export type TicketMessageAuthorType = (typeof TICKET_MESSAGE_AUTHOR_TYPES)[number];

export const TICKET_CATEGORIES = [
  'ORDER_ISSUE',
  'PAYMENT_ISSUE',
  'DELIVERY_ISSUE',
  'PRODUCT_QUESTION',
  'ACCOUNT_ISSUE',
  'OTHER',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
