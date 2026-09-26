/** How a product is delivered to the customer. Fully admin-configurable — never hardcoded per product. */
export const DELIVERY_TYPES = [
  'AUTOMATIC',
  'MANUAL',
  'LICENSE_KEY',
  'ACCOUNT',
  'VOUCHER',
  'CODE',
  'CUSTOM',
] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

/** What kind of digital good the product represents. */
export const FULFILLMENT_TYPES = [
  'ACCOUNT',
  'KEY',
  'CDK',
  'VOUCHER',
  'SUBSCRIPTION',
  'DIGITAL_FILE',
  'MANUAL_SERVICE',
  'CUSTOM',
] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

/** Whether inventory for this product is tracked as a bare quantity or as individual secret-bearing units. */
export const INVENTORY_MODES = ['QUANTITY', 'INDIVIDUAL'] as const;
export type InventoryMode = (typeof INVENTORY_MODES)[number];

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_VISIBILITIES = ['VISIBLE', 'HIDDEN'] as const;
export type ProductVisibility = (typeof PRODUCT_VISIBILITIES)[number];

export const INVENTORY_ITEM_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'SOLD',
  'DELIVERED',
  'DISABLED',
] as const;
export type InventoryItemStatus = (typeof INVENTORY_ITEM_STATUSES)[number];
