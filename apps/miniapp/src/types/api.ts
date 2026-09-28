import type {
  DeliveryType,
  FulfillmentType,
  InventoryMode,
  OrderStatus,
  PaginatedResult,
} from '@sqlm/shared';

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  images: string[];
  price: string;
  compareAtPrice: string | null;
  currency: string;
  duration: string | null;
  warranty: string | null;
  availableStock: number;
  inventoryMode: InventoryMode;
  deliveryType: DeliveryType;
  fulfillmentType: FulfillmentType;
  activationInstructions: string | null;
  featured: boolean;
  tags: string[];
}

export type PaymentProvider = 'MANUAL' | 'BINANCE' | 'BYBIT';

export interface PaymentMethod {
  id: string;
  name: string;
  description: string | null;
  accountNumber: string | null;
  instructions: string | null;
  qrCodeUrl: string | null;
  currency: string;
  provider?: PaymentProvider;
}

/** The live deposit watch behind a self-settling payment method. */
export interface CryptoPayment {
  orderId: string;
  provider: PaymentProvider;
  asset: string;
  network: string;
  address: string;
  /** The exact amount to send — the order total plus its identifying delta. */
  amount: string;
  status: 'WAITING' | 'MATCHED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
  matchedAt: string | null;
  extensionsUsed: number;
  /** How many more times the countdown may be pushed out. */
  extensionsLeft: number;
  /** False when the store has no key for this exchange, so nothing is
   *  actually watching and the customer must still upload a receipt. */
  autoConfirmActive: boolean;
}

export interface OrderItem {
  id: string;
  productId: string;
  productNameSnapshot: string;
  unitPrice: string;
  quantity: number;
  product?: { slug: string; images: string[] };
}

export interface Order {
  id: string;
  sequenceNumber: number;
  status: OrderStatus;
  currency: string;
  subtotal: string;
  /** Everything taken off — member discount plus coupon. "0" when none. */
  discountTotal: string;
  /** The verified discount or the welcome gift; part of discountTotal. */
  memberDiscount: string;
  memberDiscountKind: MemberDiscountKind | null;
  total: string;
  couponCode: string | null;
  /** What to actually transfer when the payment method is in another
   *  currency (USD prices paid in EGP). Frozen when the order was placed. */
  payCurrency: string | null;
  payAmount: string | null;
  exchangeRate: string | null;
  paymentMethodId: string | null;
  createdAt: string;
  items: OrderItem[];
  paymentMethod?: PaymentMethod | null;
  paymentProofs?: Array<{ id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; rejectionReason: string | null; uploadedAt: string }>;
}

export interface CustomerDelivery {
  id: string;
  orderItemId: string;
  productName: string;
  method: string;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  content: string | null;
  note: string | null;
  deliveredAt: string | null;
}

export interface StoreInfo {
  name: string;
  supportContact: string;
  /** Display-only estimate rate; orders carry their own frozen rate. */
  egpPerUsd?: number;
}

export interface Ticket {
  id: string;
  ticketNumber: number;
  subject: string;
  status: string;
  category: string;
  customerUnread: number;
  lastMessageAt: string | null;
  createdAt: string;
  orderId: string | null;
}

export interface TicketThread extends Ticket {
  messages: Array<{ id: string; authorType: 'CUSTOMER' | 'STAFF' | 'SYSTEM'; message: string; createdAt: string }>;
}

export interface CustomerProfile {
  id: string;
  telegramId: string;
  firstName: string | null;
  username: string | null;
}

export type { PaginatedResult };


export type MemberDiscountKind = 'VERIFIED' | 'WELCOME';

/** The server's price for a cart — the same function checkout charges with. */
export interface OrderQuote {
  currency: string;
  subtotal: string;
  member: { kind: MemberDiscountKind; percent: number; amount: string } | null;
  coupon: { code: string; discount: string } | null;
  discountTotal: string;
  total: string;
  /** What the transfer comes to with each enabled payment method. */
  paymentOptions: Array<{ paymentMethodId: string; currency: string; amount: string; rate: string | null }>;
}

export interface CustomerPerks {
  tier: 'VERIFIED' | 'REGULAR';
  verifiedAt: string | null;
  verifiedDiscountPercent: number;
  welcomeGift: { percent: number; available: boolean; message: string } | null;
}
