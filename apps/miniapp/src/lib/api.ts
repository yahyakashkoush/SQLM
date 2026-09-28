import { useAuthStore } from '@/store/auth-store';
import type {
  Category,
  CustomerDelivery,
  CryptoPayment,
  CouponQuote,
  CustomerProfile,
  Order,
  PaginatedResult,
  PaymentMethod,
  Product,
  StoreInfo,
  Ticket,
  TicketThread,
} from '@/types/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * A customer access token lives 24h and there is no refresh token — the
 * Mini App re-derives a session from Telegram's initData instead. But the
 * provider only authenticates when no token is stored, and the store is
 * persisted, so a customer returning after 24h kept presenting the dead
 * token: every authenticated call failed with "Invalid or expired session"
 * and nothing ever replaced it. Checkout was a permanent dead end until
 * they cleared the app's storage by hand.
 *
 * Recovering here rather than at each call site means anything that talks
 * to the API self-heals on the first 401.
 */
let telegramInitData: string | null = null;
let reauthInFlight: Promise<boolean> | null = null;

export function setTelegramInitData(initData: string | null): void {
  telegramInitData = initData;
}

/** Shared so a page firing several requests at once re-authenticates once. */
function reauthenticate(): Promise<boolean> {
  if (!telegramInitData) return Promise.resolve(false);

  return (reauthInFlight ??= (async () => {
    try {
      const res = await api.authenticateTelegram(telegramInitData!);
      useAuthStore.getState().setSession(res.accessToken, res.customer);
      return true;
    } catch {
      // initData itself is rejected now — drop the session so the provider
      // shows the sign-in error instead of retrying forever.
      useAuthStore.getState().clearSession();
      return false;
    } finally {
      reauthInFlight = null;
    }
  })());
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  auth = false,
  isRetry = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers, cache: 'no-store' });

  // Once only: a second 401 means the fresh token is being rejected too,
  // which is a real failure rather than an expired session.
  if (res.status === 401 && auth && !isRetry && (await reauthenticate())) {
    return request<T>(path, init, auth, true);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ message: res.statusText }))) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join('، ') : body.message;
    throw new ApiError(res.status, message ?? 'حصل خطأ، حاول مرة أخرى');
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  authenticateTelegram: (initData: string) =>
    request<{ accessToken: string; customer: CustomerProfile }>('/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    }),
  me: () => request<CustomerProfile>('/auth/telegram/me', {}, true),

  listCategories: () => request<Category[]>('/categories'),

  listProducts: (params: { category?: string; search?: string; featured?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.category) qs.set('category', params.category);
    if (params.search) qs.set('search', params.search);
    if (params.featured) qs.set('featured', 'true');
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<PaginatedResult<Product>>(`/products${suffix}`);
  },
  getProduct: (slug: string) => request<Product>(`/products/${slug}`),

  listPaymentMethods: () => request<PaymentMethod[]>('/payment-methods'),

  checkout: (payload: {
    items: Array<{ productId: string; quantity: number }>;
    paymentMethodId: string;
    idempotencyKey: string;
    couponCode?: string;
  }) => request<Order>('/orders/checkout', { method: 'POST', body: JSON.stringify(payload) }, true),

  cancelOrder: (id: string, reason?: string) =>
    request<Order>(`/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }, true),

  quoteCoupon: (code: string, items: Array<{ productId: string; quantity: number }>) =>
    request<CouponQuote>('/coupons/quote', { method: 'POST', body: JSON.stringify({ code, items }) }, true),

  listOrders: () => request<PaginatedResult<Order>>('/orders', {}, true),
  getOrder: (id: string) => request<Order>(`/orders/${id}`, {}, true),

  getDeliveries: (orderId: string) => request<CustomerDelivery[]>(`/orders/${orderId}/deliveries`, {}, true),

  getCryptoPayment: (orderId: string) =>
    request<CryptoPayment>(`/orders/${orderId}/crypto-payment`, {}, true),

  extendCryptoPayment: (orderId: string) =>
    request<CryptoPayment>(`/orders/${orderId}/crypto-payment/extend`, { method: 'POST' }, true),

  storeInfo: () => request<StoreInfo>('/store'),

  listTickets: () => request<PaginatedResult<Ticket>>('/support/tickets', {}, true),
  getTicket: (id: string) => request<TicketThread>(`/support/tickets/${id}`, {}, true),
  createTicket: (payload: { subject: string; message: string; category?: string; orderId?: string }) =>
    request<Ticket>('/support/tickets', { method: 'POST', body: JSON.stringify(payload) }, true),
  replyTicket: (id: string, message: string) =>
    request(`/support/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify({ message }) }, true),

  uploadPaymentProof: (orderId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ id: string; status: string }>(
      `/orders/${orderId}/payment-proof`,
      { method: 'POST', body: form },
      true,
    );
  },
};
