import { useAuthStore } from '@/store/auth-store';
import type {
  Category,
  CustomerDelivery,
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

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers, cache: 'no-store' });

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
  }) => request<Order>('/orders/checkout', { method: 'POST', body: JSON.stringify(payload) }, true),

  listOrders: () => request<PaginatedResult<Order>>('/orders', {}, true),
  getOrder: (id: string) => request<Order>(`/orders/${id}`, {}, true),

  getDeliveries: (orderId: string) => request<CustomerDelivery[]>(`/orders/${orderId}/deliveries`, {}, true),

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
