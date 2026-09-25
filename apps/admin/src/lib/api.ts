import { useAuthStore } from '@/store/auth-store';

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
 * Staff API client. On a 401 it tries the refresh token exactly once and
 * replays the request; if that also fails the session is cleared, since at
 * that point the refresh token is revoked or expired and retrying again
 * would just loop.
 */
async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const token = useAuthStore.getState().accessToken;
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers, cache: 'no-store' });

  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, false);
    useAuthStore.getState().clearSession();
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ message: res.statusText }))) as {
      message?: string | string[];
    };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, message ?? 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/staff/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    const { staff } = useAuthStore.getState();
    if (!staff) return false;
    useAuthStore.getState().setSession(data.accessToken, data.refreshToken, staff);
    return true;
  } catch {
    return false;
  }
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const patch = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: 'DELETE' });

export const api = {
  login: (email: string, password: string) =>
    request<{
      accessToken: string;
      refreshToken: string;
      staff: import('@/store/auth-store').StaffProfile;
    }>('/auth/staff/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false),
  logout: (refreshToken: string) => post('/auth/staff/logout', { refreshToken }),

  stats: () => get<Record<string, never>>('/admin/stats'),

  products: (qs = '') => get<Paginated<AdminProduct>>(`/admin/products${qs}`),
  product: (id: string) => get<AdminProduct>(`/admin/products/${id}`),
  createProduct: (body: unknown) => post<AdminProduct>('/admin/products', body),
  updateProduct: (id: string, body: unknown) => patch<AdminProduct>(`/admin/products/${id}`, body),
  deleteProduct: (id: string) => del(`/admin/products/${id}`),

  categories: () => get<AdminCategory[]>('/admin/categories'),
  createCategory: (body: unknown) => post<AdminCategory>('/admin/categories', body),
  updateCategory: (id: string, body: unknown) => patch(`/admin/categories/${id}`, body),

  inventory: (productId: string, qs = '') =>
    get<Paginated<InventoryItem>>(`/admin/inventory/products/${productId}${qs}`),
  importInventory: (productId: string, secrets: string[]) =>
    post<{ imported: number }>(`/admin/inventory/products/${productId}/import`, { secrets }),
  revealInventory: (id: string) => post<{ secret: string }>(`/admin/inventory/${id}/reveal`),
  disableInventory: (id: string, reason: string) =>
    patch(`/admin/inventory/${id}/disable`, { reason }),

  orders: (qs = '') => get<Paginated<AdminOrder>>(`/admin/orders${qs}`),
  order: (id: string) => get<AdminOrder>(`/admin/orders/${id}`),
  transitionOrder: (id: string, toStatus: string, note?: string) =>
    post<AdminOrder>(`/admin/orders/${id}/transition`, { toStatus, note }),

  paymentMethods: () => get<PaymentMethod[]>('/admin/payment-methods'),
  createPaymentMethod: (body: unknown) => post<PaymentMethod>('/admin/payment-methods', body),
  updatePaymentMethod: (id: string, body: unknown) => patch(`/admin/payment-methods/${id}`, body),
  deletePaymentMethod: (id: string) => del(`/admin/payment-methods/${id}`),

  paymentProofs: () => get<PaymentProof[]>('/admin/payment-proofs'),
  paymentProof: (id: string) => get<PaymentProof>(`/admin/payment-proofs/${id}`),
  proofViewUrl: (id: string) => get<{ url: string }>(`/admin/payment-proofs/${id}/view-url`),
  approveProof: (id: string) => post(`/admin/payment-proofs/${id}/approve`),
  rejectProof: (id: string, reason: string, cancelOrder: boolean) =>
    post(`/admin/payment-proofs/${id}/reject`, { reason, cancelOrder }),

  pendingDeliveries: () => get<PendingDelivery[]>('/admin/deliveries/pending'),
  orderDeliveries: (orderId: string) => get<PendingDelivery[]>(`/admin/deliveries/order/${orderId}`),
  fulfillDelivery: (id: string, content: string, note?: string) =>
    post(`/admin/deliveries/${id}/fulfill`, { content, note }),
  retryDelivery: (orderId: string) => post(`/admin/deliveries/order/${orderId}/retry`),

  tickets: (qs = '') => get<Paginated<AdminTicket>>(`/admin/support/tickets${qs}`),
  ticket: (id: string) => get<AdminTicketThread>(`/admin/support/tickets/${id}`),
  replyTicket: (id: string, message: string, internal = false) =>
    post(`/admin/support/tickets/${id}/messages`, { message, internal }),
  assignTicket: (id: string, staffId: string | null) =>
    patch(`/admin/support/tickets/${id}/assign`, { staffId }),
  setTicketStatus: (id: string, status: string) =>
    patch(`/admin/support/tickets/${id}/status`, { status }),

  customers: (qs = '') => get<Paginated<AdminCustomer>>(`/admin/customers${qs}`),
  customer: (id: string) => get<AdminCustomerDetail>(`/admin/customers/${id}`),

  staff: () => get<StaffRow[]>('/admin/staff'),
  createStaff: (body: unknown) => post<StaffRow>('/admin/staff', body),
  updateStaff: (id: string, body: unknown) => patch<StaffRow>(`/admin/staff/${id}`, body),

  auditLogs: (qs = '') => get<Paginated<AuditLogRow>>(`/admin/audit-logs${qs}`),

  settings: () => get<SettingRow[]>('/admin/settings'),
  updateSetting: (key: string, value: unknown) => patch(`/admin/settings/${key}`, { value }),

  roles: () => get<Array<{ role: string; permissions: string[] }>>('/rbac/roles'),
};

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  price: string;
  compareAtPrice: string | null;
  currency: string;
  stock: number;
  availableStock: number;
  inventoryMode: string;
  deliveryType: string;
  fulfillmentType: string;
  status: string;
  visibility: string;
  featured: boolean;
  categoryId: string | null;
  duration: string | null;
  warranty: string | null;
  tags: string[];
}

export interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  displayOrder: number;
}

export interface InventoryItem {
  id: string;
  status: string;
  orderId: string | null;
  reservedAt: string | null;
  soldAt: string | null;
  deliveredAt: string | null;
  disabledReason: string | null;
  createdAt: string;
}

export interface AdminOrder {
  id: string;
  sequenceNumber: number;
  status: string;
  currency: string;
  total: string;
  customerId: string;
  paymentMethodId: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    productNameSnapshot: string;
    quantity: number;
    unitPrice: string;
  }>;
}

export interface PaymentMethod {
  id: string;
  name: string;
  description: string | null;
  accountNumber: string | null;
  instructions: string | null;
  currency: string;
  enabled: boolean;
  displayOrder: number;
}

export interface PaymentProof {
  id: string;
  orderId: string;
  customerId: string;
  status: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  rejectionReason: string | null;
  order?: { sequenceNumber: number; total: string; currency: string; status: string };
  customer?: { firstName: string | null; telegramUsername: string | null };
}

export interface PendingDelivery {
  id: string;
  orderId: string;
  method: string;
  status: string;
  note: string | null;
  lastError: string | null;
  attempts: number;
  deliveredAt: string | null;
  orderItem: { productNameSnapshot: string; quantity: number };
  order?: { sequenceNumber: number };
}

export interface AdminTicket {
  id: string;
  ticketNumber: number;
  subject: string;
  status: string;
  category: string;
  staffUnread: number;
  lastMessageAt: string | null;
  assignedStaffId: string | null;
  customer?: { firstName: string | null; telegramUsername: string | null };
  assignedStaff?: { id: string; name: string } | null;
}

export interface AdminTicketThread extends AdminTicket {
  messages: Array<{
    id: string;
    authorType: string;
    message: string;
    internal: boolean;
    createdAt: string;
  }>;
  order?: { id: string; sequenceNumber: number; status: string } | null;
}

export interface AdminCustomer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  telegramUsername: string | null;
  status: string;
  createdAt: string;
  _count: { orders: number; supportTickets: number };
}

export interface AdminCustomerDetail extends Omit<AdminCustomer, '_count'> {
  orders: Array<{
    id: string;
    sequenceNumber: number;
    status: string;
    total: string;
    createdAt: string;
  }>;
  supportTickets: Array<{ id: string; ticketNumber: number; subject: string; status: string }>;
}

export interface StaffRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  changes: unknown;
  createdAt: string;
  actorStaff: { id: string; name: string; email: string } | null;
}

export interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface DashboardStats {
  ordersByStatus: Record<string, number>;
  pendingProofs: number;
  pendingDeliveries: number;
  openTickets: number;
  unreadTickets: number;
  lowStockProducts: number;
  revenue: string;
  customers: number;
}
