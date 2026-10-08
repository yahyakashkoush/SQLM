import { ROLE_PERMISSIONS, type Permission, type Role } from '@sqlm/shared';
import { ApiError, getTelegramInitData } from '@/lib/api';
import { useStaffStore, type StaffSession } from '@/store/staff-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  staff: StaffSession;
}

let signingIn: Promise<void> | null = null;

async function raw<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers, cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ message: res.statusText }))) as {
      message?: string | string[];
      code?: string;
    };
    const message = Array.isArray(body.message) ? body.message.join('، ') : body.message;
    throw new ApiError(res.status, message ?? 'حصل خطأ، حاول تاني', body.code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Refresh token first; failing that, sign in again from the Telegram session. */
export function ensureStaffSession(force = false): Promise<void> {
  const state = useStaffStore.getState();
  if (state.accessToken && !force) return Promise.resolve();
  return (signingIn ??= (async () => {
    try {
      if (state.refreshToken) {
        try {
          const pair = await raw<TokenPair>('/auth/staff/refresh', {
            method: 'POST',
            body: JSON.stringify({ refreshToken: state.refreshToken }),
          });
          useStaffStore.getState().setSession(pair);
          return;
        } catch {
          // fall through to a fresh Telegram sign-in
        }
      }
      const initData = getTelegramInitData();
      if (!initData) throw new ApiError(401, 'افتح لوحة التحكم من جوه تيليجرام.', 'NO_TELEGRAM');
      const pair = await raw<TokenPair>('/auth/staff/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData }),
      });
      useStaffStore.getState().setSession(pair);
    } catch (err) {
      useStaffStore.getState().clearSession();
      throw err;
    } finally {
      signingIn = null;
    }
  })());
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  await ensureStaffSession();
  try {
    return await raw<T>(path, init, useStaffStore.getState().accessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await ensureStaffSession(true);
      return raw<T>(path, init, useStaffStore.getState().accessToken);
    }
    throw err;
  }
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export function staffCan(permission: Permission): boolean {
  const role = useStaffStore.getState().staff?.role as Role | undefined;
  return role ? (ROLE_PERMISSIONS[role] ?? []).includes(permission) : false;
}

// ----------------------------------------------------------------------------- types

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface Stats {
  ordersByStatus: Record<string, number>;
  pendingProofs: number;
  pendingDeliveries: number;
  openTickets: number;
  unreadTickets: number;
  lowStockProducts: number;
  revenue: string;
  customers: number;
}

export interface Figures {
  revenue: string;
  cost: string;
  profit: string;
  margin: number | null;
  orders: number;
  units: number;
}

export interface Profits {
  currency: string;
  totals: Figures & {
    averageOrder: string;
    costCoverage: number;
    walletLiability: string;
    refunds: { count: number; amount: string };
  };
  daily: Array<Figures & { date: string }>;
  products: Array<Figures & { id: string; name: string }>;
  customers: Array<Figures & { id: string; name: string; merchant: boolean }>;
  channels: Array<Figures & { name: string }>;
}

export interface PendingProof {
  id: string;
  orderId: string;
  customerId: string;
  mimeType: string;
  uploadedAt: string;
  senderReference: string | null;
  order: {
    sequenceNumber: number;
    total: string;
    currency: string;
    payAmount: string | null;
    payCurrency: string | null;
    paymentMethod: { name: string } | null;
  };
  customer: { firstName: string | null; fullName: string | null; telegramUsername: string | null };
  risk: {
    flags: string[];
    previousRejections: number;
    paidOrders: number;
    accountAgeHours: number;
  };
}

export interface TopUp {
  id: string;
  amount: string;
  currency: string;
  payAmount: string | null;
  payCurrency: string | null;
  senderReference: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
  createdAt: string;
  customer: {
    id: string;
    firstName: string | null;
    fullName: string | null;
    telegramUsername: string | null;
    walletBalance: string;
  };
  paymentMethod: { name: string } | null;
  reviewedBy: { name: string } | null;
}

export interface OrderRow {
  id: string;
  sequenceNumber: number;
  status: string;
  walletPaid?: boolean;
  currency: string;
  total: string;
  createdAt: string;
  items: Array<{ id: string; productNameSnapshot: string; quantity: number }>;
  customer?: { id: string; firstName: string | null; telegramUsername: string | null };
  paymentMethod?: { name: string } | null;
}

export interface OrderDetail extends OrderRow {
  subtotal: string;
  discountTotal: string;
  couponCode: string | null;
  payAmount: string | null;
  payCurrency: string | null;
  cancelReason: string | null;
  paidAt: string | null;
  items: Array<{
    id: string;
    productNameSnapshot: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string | null;
    bundleLabel: string | null;
  }>;
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    telegramUsername: string | null;
    fullName: string | null;
    contactPhone: string | null;
    status: string;
  };
  paymentProofs: Array<{
    id: string;
    status: string;
    senderReference: string | null;
    uploadedAt: string;
    rejectionReason: string | null;
  }>;
}

export interface CustomerRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  telegramUsername: string | null;
  status: string;
  verifiedAt: string | null;
  createdAt: string;
  paidOrders: number;
  totalSpent: string;
}

export interface CustomerDetail extends CustomerRow {
  fullName: string | null;
  contactPhone: string | null;
  phone: string | null;
  wholesaleAt: string | null;
  suspendedUntil: string | null;
  suspendReason: string | null;
  banReason: string | null;
  rejectedProofs: number;
  strikes: Array<{ id: string; source: string; reason: string; action: string; createdAt: string }>;
  orders: Array<{
    id: string;
    sequenceNumber: number;
    status: string;
    total: string;
    createdAt: string;
  }>;
}

export interface CustomerWallet {
  balance: string;
  currency: string;
  member: boolean;
  entries: Array<{
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    note: string | null;
    createdAt: string;
  }>;
}

export interface WholesaleApp {
  id: string;
  businessName: string;
  contactPhone: string;
  monthlyVolume: string | null;
  notes: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    telegramUsername: string | null;
  };
}

export interface ProductRow {
  id: string;
  name: string;
  slug: string;
  price: string;
  currency: string;
  status: string;
  visibility: string;
  inventoryMode: string;
  stock: number;
  availableStock: number;
  images: string[];
  costPrice: string | null;
}

export interface OrderDelivery {
  id: string;
  method: string;
  status: string;
  note: string | null;
  lastError: string | null;
  deliveredAt: string | null;
  orderItem: {
    productNameSnapshot: string;
    quantity: number;
    product?: { activationInstructions: string | null };
  };
}

// ----------------------------------------------------------------------------- calls

export const adminApi = {
  stats: () => get<Stats>('/admin/stats'),
  profits: (from: string, to: string) => get<Profits>(`/admin/profits?from=${from}&to=${to}`),

  proofs: () => get<PendingProof[]>('/admin/payment-proofs'),
  proofUrl: (id: string) => get<{ url: string }>(`/admin/payment-proofs/${id}/view-url`),
  approveProof: (id: string) => post(`/admin/payment-proofs/${id}/approve`),
  rejectProof: (id: string, reason: string, cancelOrder: boolean) =>
    post(`/admin/payment-proofs/${id}/reject`, { reason, cancelOrder }),

  topUps: (status: string) => get<TopUp[]>(`/admin/wallet/topups?status=${status}`),
  topUpProof: (id: string) =>
    get<{ url: string; mimeType: string }>(`/admin/wallet/topups/${id}/proof`),
  reviewTopUp: (id: string, body: { approve: boolean; reason?: string; amount?: number }) =>
    post<{ balance: string | null }>(`/admin/wallet/topups/${id}/review`, body),

  orders: (qs: string) => get<Paginated<OrderRow>>(`/admin/orders?${qs}`),
  order: (id: string) => get<OrderDetail>(`/admin/orders/${id}`),
  transition: (id: string, toStatus: string, note?: string) =>
    post(`/admin/orders/${id}/transition`, { toStatus, note }),

  deliveries: (orderId: string) => get<OrderDelivery[]>(`/admin/deliveries/order/${orderId}`),
  fulfill: (deliveryId: string, content: string) =>
    post(`/admin/deliveries/${deliveryId}/fulfill`, { content }),

  customers: (qs: string) => get<Paginated<CustomerRow>>(`/admin/customers?${qs}`),
  customer: (id: string) => get<CustomerDetail>(`/admin/customers/${id}`),
  message: (id: string, message: string) =>
    post(`/admin/customers/${id}/message`, { message, withStoreButton: true }),
  suspend: (id: string, hours: number, reason: string) =>
    post(`/admin/customers/${id}/suspend`, { hours, reason }),
  lift: (id: string) => post(`/admin/customers/${id}/lift-suspension`),
  ban: (id: string, reason: string) =>
    post<{ cancelledOrders: number }>(`/admin/customers/${id}/ban`, { reason }),
  unban: (id: string) => post(`/admin/customers/${id}/unban`),
  wallet: (id: string) => get<CustomerWallet>(`/admin/wallet/customers/${id}`),
  adjustWallet: (id: string, amount: number, note: string) =>
    post<{ balance: string }>(`/admin/wallet/customers/${id}/adjust`, {
      amount,
      note,
      type: 'ADJUSTMENT',
    }),

  wholesale: (status: string) => get<WholesaleApp[]>(`/admin/wholesale?status=${status}`),
  reviewWholesale: (id: string, approve: boolean) =>
    post(`/admin/wholesale/${id}/review`, { approve }),

  products: (qs: string) => get<Paginated<ProductRow>>(`/admin/products?${qs}`),
  updateProduct: (
    id: string,
    body: Partial<{ status: string; visibility: string; price: number }>,
  ) => patch(`/admin/products/${id}`, body),
  adjustStock: (id: string, delta: number) =>
    post<{ stock: number }>(`/admin/inventory/products/${id}/adjust-stock`, { delta }),
};
