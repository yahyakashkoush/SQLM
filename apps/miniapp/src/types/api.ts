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
  badge: string | null;
  ratingScore: string | null;
  reviewCount: number;
  /** Retail bundles; wholesale ones come from /wholesale for members only. */
  bundles?: ProductBundle[];
}

export interface ProductBundle {
  id: string;
  label: string | null;
  quantity: number;
  /** Price of the whole bundle. */
  price: string;
  wholesaleOnly?: boolean;
}

export interface AccountProfile {
  fullName: string | null;
  contactPhone: string | null;
  needsContact: boolean;
  wholesale: boolean;
  firstName: string | null;
  memberSince: string;
  /** Merchants only: their prepaid balance. */
  wallet: { balance: string; currency: string } | null;
  /** This Telegram account is staff — the app shows its admin mode. */
  staff: { role: string; name: string } | null;
}

export type WalletEntryType = 'TOPUP' | 'PURCHASE' | 'REFUND' | 'ADJUSTMENT';

export interface WalletSummary {
  enabled: boolean;
  balance: string;
  currency: string;
  pendingTopUps: Array<{ id: string; amount: string; currency: string; payAmount: string | null; payCurrency: string | null; createdAt: string }>;
  entries: Array<{
    id: string;
    type: WalletEntryType;
    amount: string;
    balanceAfter: string;
    currency: string;
    note: string | null;
    createdAt: string;
    order: { id: string; sequenceNumber: number } | null;
  }>;
}

export interface WalletTopUpRow {
  id: string;
  amount: string;
  currency: string;
  payAmount: string | null;
  payCurrency: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paymentMethod: { name: string } | null;
}

export interface TopUpMethod {
  id: string;
  name: string;
  description: string | null;
  accountNumber: string | null;
  instructions: string | null;
  qrCodeUrl: string | null;
  logoUrl?: string | null;
  currency: string;
  payAmount: string;
  payCurrency: string;
}

export interface WholesaleStatus {
  member: boolean;
  memberSince: string | null;
  accepting: boolean;
  terms: string;
  application: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; staffNote: string | null; createdAt: string } | null;
}

export interface GiftProduct {
  id: string;
  name: string;
  shortDescription: string | null;
  images: string[];
  giftType: 'INSTANT_FREE' | 'SOCIAL_REWARD';
  maxGiftClaims: number | null;
  giftClaimsCount: number;
  remainingClaims: number | null;
  isSoldOut: boolean;
  ratingScore: string | null;
  reviewCount: number;
  badge: string | null;
  socialPostUrl: string | null;
  socialPageUrl: string | null;
}

export interface SocialRewardClaim {
  id: string;
  productId: string;
  claimType: 'FACEBOOK_COMMENT' | 'FACEBOOK_RATING';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  createdAt: string;
  product: { id: string; name: string; images: string[] };
}

export type PaymentProvider = 'MANUAL' | 'BINANCE' | 'BYBIT';

export interface PaymentMethod {
  id: string;
  name: string;
  description: string | null;
  accountNumber: string | null;
  instructions: string | null;
  qrCodeUrl: string | null;
  logoUrl?: string | null;
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
  lineTotal?: string | null;
  bundleLabel?: string | null;
  product?: { slug: string; images: string[]; status?: string; visibility?: string };
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
  /** Settled from the merchant's wallet balance. */
  walletPaid?: boolean;
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
  deliveryTime?: string;
  /** Shown on the payment step: what happens to a fake receipt. */
  proofWarning?: string;
  rules?: string;
  terms?: string;
  botUsername?: string | null;
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


export type MemberDiscountKind = 'VERIFIED' | 'WELCOME' | 'LEGACY';

export const MEMBER_DISCOUNT_LABELS: Record<MemberDiscountKind, string> = {
  VERIFIED: 'خصم العميل المميز',
  WELCOME: 'هدية أول طلب',
  LEGACY: 'خصم العميل القديم',
};

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
  tier: 'LEGACY' | 'VERIFIED' | 'REGULAR';
  verifiedAt: string | null;
  verifiedDiscountPercent: number;
  /** Set once matched to the store's old-customers list. */
  legacyDiscountPercent: number | null;
  /** Unmatched customers can claim it from the bot while this is on. */
  legacyOfferAvailable: boolean;
  welcomeGift: { percent: number; available: boolean; message: string } | null;
}
