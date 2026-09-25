/**
 * How an order item was actually fulfilled. Resolved at fulfillment time
 * from the product's DeliveryType + InventoryMode — a product configured
 * AUTOMATIC but backed by QUANTITY stock has no stored secret to hand over,
 * so it resolves to MANUAL rather than delivering nothing.
 */
export const DELIVERY_METHODS = ['AUTOMATIC', 'MANUAL'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const DELIVERY_STATUSES = ['PENDING', 'DELIVERED', 'FAILED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
