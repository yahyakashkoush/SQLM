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

export interface PaymentMethod {
  id: string;
  name: string;
  description: string | null;
  accountNumber: string | null;
  instructions: string | null;
  qrCodeUrl: string | null;
  currency: string;
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
  total: string;
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
