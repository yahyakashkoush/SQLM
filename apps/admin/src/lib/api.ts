import type { CustomerSegment, SettingGroup } from '@sqlm/shared';
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
  productBundles: (id: string) => get<SavedBundle[]>(`/admin/products/${id}/bundles`),
  addBundle: (id: string, body: BundleInput) =>
    post<{ bundle: SavedBundle; bundles: SavedBundle[] }>(`/admin/products/${id}/bundles`, body),
  updateBundle: (id: string, bundleId: string, body: Partial<BundleInput>) =>
    patch<{ bundle: SavedBundle; bundles: SavedBundle[] }>(`/admin/products/${id}/bundles/${bundleId}`, body),
  deleteBundle: (id: string, bundleId: string) =>
    del<{ bundles: SavedBundle[] }>(`/admin/products/${id}/bundles/${bundleId}`),
  deleteProduct: (id: string) => del(`/admin/products/${id}`),
  /** Gone for good with its stock; refused (409) while any order references it. */
  deleteProductPermanently: (id: string) =>
    del<{ id: string; deletedInventory: number }>(`/admin/products/${id}/permanent`),

  categories: () => get<AdminCategory[]>('/admin/categories'),
  createCategory: (body: unknown) => post<AdminCategory>('/admin/categories', body),
  updateCategory: (id: string, body: unknown) => patch(`/admin/categories/${id}`, body),
  deleteCategory: (id: string) => del(`/admin/categories/${id}`),

  uploadImage: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ key: string; url: string }>('/admin/uploads/images', { method: 'POST', body: form });
  },

  deliveryTemplates: () => get<DeliveryTemplate[]>('/admin/delivery-templates'),
  createDeliveryTemplate: (body: unknown) => post<DeliveryTemplate>('/admin/delivery-templates', body),
  updateDeliveryTemplate: (id: string, body: unknown) =>
    patch<DeliveryTemplate>(`/admin/delivery-templates/${id}`, body),
  deleteDeliveryTemplate: (id: string) => del(`/admin/delivery-templates/${id}`),

  botStatus: () => get<BotStatus>('/admin/bot'),
  myTelegram: () => get<StaffTelegramLink>('/admin/bot/me'),
  createTelegramLink: () => post<{ url: string; expiresAt: string }>('/admin/bot/me/link'),
  setTelegramNotify: (notify: boolean) => patch<StaffTelegramLink>('/admin/bot/me', { notify }),
  unlinkTelegram: () => del<StaffTelegramLink>('/admin/bot/me/link'),
  testTelegram: () => post<{ sent: boolean }>('/admin/bot/me/test'),
  botReconnect: () => post<BotStatus>('/admin/bot/reconnect'),
  botUpdateProfile: (body: { name?: string; description?: string; shortDescription?: string }) =>
    patch<BotStatus>('/admin/bot/profile', body),

  inventory: (productId: string, qs = '') =>
    get<Paginated<InventoryItem>>(`/admin/inventory/products/${productId}${qs}`),
  importInventory: (productId: string, secrets: string[]) =>
    post<{ imported: number }>(`/admin/inventory/products/${productId}/import`, { secrets }),
  revealInventory: (id: string) => post<{ secret: string }>(`/admin/inventory/${id}/reveal`),
  adjustStock: (productId: string, delta: number) =>
    post<{ stock: number }>(`/admin/inventory/products/${productId}/adjust-stock`, { delta }),
  disableInventory: (id: string, reason: string) =>
    patch(`/admin/inventory/${id}/disable`, { reason }),

  orders: (qs = '') => get<Paginated<AdminOrder>>(`/admin/orders${qs}`),
  deleteOrder: (id: string, restock = false) =>
    del<DeletedOrder>(`/admin/orders/${id}${restock ? '?restock=true' : ''}`),
  deleteOrders: (ids: string[], restock = false) =>
    post<{ deleted: DeletedOrder[]; failed: Array<{ id: string; error: string }> }>('/admin/orders/bulk-delete', {
      ids,
      restock,
    }),
  order: (id: string) => get<AdminOrderDetail>(`/admin/orders/${id}`),
  transitionOrder: (id: string, toStatus: string, note?: string) =>
    post<AdminOrder>(`/admin/orders/${id}/transition`, { toStatus, note }),

  paymentMethods: () => get<PaymentMethod[]>('/admin/payment-methods'),
  createPaymentMethod: (body: unknown) => post<PaymentMethod>('/admin/payment-methods', body),
  updatePaymentMethod: (id: string, body: unknown) => patch(`/admin/payment-methods/${id}`, body),

  cryptoProviders: () => get<CryptoProviderStatus[]>('/admin/crypto-payments/providers'),
  cryptoWatches: (status?: string) =>
    get<CryptoWatch[]>(`/admin/crypto-payments/watches${status ? `?status=${status}` : ''}`),
  cryptoDeposits: (unmatched?: boolean) =>
    get<CryptoDeposit[]>(`/admin/crypto-payments/deposits${unmatched ? '?unmatched=true' : ''}`),
  cryptoPollNow: () => post<CryptoPollSummary>('/admin/crypto-payments/poll', {}),
  matchCryptoDeposit: (depositId: string, orderId: string) =>
    post<{ matched: true }>(`/admin/crypto-payments/deposits/${depositId}/match`, { orderId }),

  coupons: () => get<Coupon[]>('/admin/coupons'),
  createCoupon: (payload: CouponInput) => post<Coupon>('/admin/coupons', payload),
  updateCoupon: (id: string, payload: Partial<CouponInput>) =>
    patch<Coupon>(`/admin/coupons/${id}`, payload),
  deactivateCoupon: (id: string) => del(`/admin/coupons/${id}`),

  revenue: (days: number) => get<RevenueReport>(`/admin/revenue?days=${days}`),
  profits: (from: string, to: string) => get<ProfitReport>(`/admin/profits?from=${from}&to=${to}`),
  deletePaymentMethod: (id: string) => del(`/admin/payment-methods/${id}`),

  paymentProofs: () => get<PaymentProof[]>('/admin/payment-proofs'),
  paymentProof: (id: string) => get<PaymentProof>(`/admin/payment-proofs/${id}`),
  proofViewUrl: (id: string) => get<{ url: string }>(`/admin/payment-proofs/${id}/view-url`),
  approveProof: (id: string) => post(`/admin/payment-proofs/${id}/approve`),
  rejectProof: (id: string, reason: string, cancelOrder: boolean, strike?: boolean) =>
    post(`/admin/payment-proofs/${id}/reject`, { reason, cancelOrder, strike }),

  pendingDeliveries: () => get<PendingDelivery[]>('/admin/deliveries/pending'),
  orderDeliveries: (orderId: string) => get<PendingDelivery[]>(`/admin/deliveries/order/${orderId}`),
  fulfillDelivery: (id: string, content: string, note?: string) =>
    post(`/admin/deliveries/${id}/fulfill`, { content, note }),
  retryDelivery: (orderId: string) => post(`/admin/deliveries/order/${orderId}/retry`),
  replaceDelivery: (id: string, content: string, note?: string) =>
    patch(`/admin/deliveries/${id}`, { content, note }),
  resendDelivery: (id: string) => post(`/admin/deliveries/${id}/resend`),
  deliveryContent: (id: string) => get<{ content: string | null }>(`/admin/deliveries/${id}/content`),

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
  customerSegments: () => get<Array<{ segment: CustomerSegment; count: number }>>('/admin/customers/segments'),
  setCustomerVerified: (id: string, verified: boolean) =>
    patch<{ id: string; verifiedAt: string | null }>(`/admin/customers/${id}/verification`, { verified }),
  banCustomer: (id: string, reason: string) =>
    post<{ customerId: string; cancelledOrders: number }>(`/admin/customers/${id}/ban`, { reason }),
  unbanCustomer: (id: string) => post(`/admin/customers/${id}/unban`),
  messageCustomer: (id: string, message: string, withStoreButton: boolean) =>
    post<{ ok: true }>(`/admin/customers/${id}/message`, { message, withStoreButton }),
  suspendCustomer: (id: string, hours: number, reason: string) =>
    post<{ suspendedUntil: string }>(`/admin/customers/${id}/suspend`, { hours, reason }),
  liftSuspension: (id: string) => post(`/admin/customers/${id}/lift-suspension`),
  revokeWholesale: (id: string) => post(`/admin/wholesale/customers/${id}/revoke`),

  appeals: (status?: string) => get<Appeal[]>(`/admin/appeals${status ? `?status=${status}` : ''}`),
  reviewAppeal: (id: string, accept: boolean, response?: string) =>
    post(`/admin/appeals/${id}/review`, { accept, response }),

  walletTopUps: (status?: string) => get<WalletTopUp[]>(`/admin/wallet/topups${status ? `?status=${status}` : ''}`),
  walletTopUpProof: (id: string) => get<{ url: string; mimeType: string }>(`/admin/wallet/topups/${id}/proof`),
  reviewTopUp: (id: string, body: { approve: boolean; reason?: string; amount?: number }) =>
    post<{ id: string; status: string; balance: string | null }>(`/admin/wallet/topups/${id}/review`, body),
  customerWallet: (customerId: string) => get<CustomerWallet>(`/admin/wallet/customers/${customerId}`),
  adjustWallet: (customerId: string, body: { amount: number; type: 'ADJUSTMENT' | 'REFUND'; note: string; orderId?: string }) =>
    post<{ balance: string }>(`/admin/wallet/customers/${customerId}/adjust`, body),
  wholesaleApplications: (status?: string) =>
    get<WholesaleApplication[]>(`/admin/wholesale${status ? `?status=${status}` : ''}`),
  reviewWholesale: (id: string, approve: boolean, note?: string) =>
    post(`/admin/wholesale/${id}/review`, { approve, note }),

  legacyCustomers: (search = '') =>
    get<LegacyCustomerList>(`/admin/legacy-customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  importLegacyCustomers: (text: string) =>
    post<{ added: number; updated: number; invalid: string[] }>('/admin/legacy-customers/import', { text }),
  updateLegacyCustomer: (id: string, body: { name?: string | null; discountPercent?: number | null }) =>
    patch<LegacyCustomer>(`/admin/legacy-customers/${id}`, body),
  releaseLegacyCustomer: (id: string) => post(`/admin/legacy-customers/${id}/release`),
  deleteLegacyCustomer: (id: string) => del(`/admin/legacy-customers/${id}`),

  staff: () => get<StaffRow[]>('/admin/staff'),
  createStaff: (body: unknown) => post<StaffRow>('/admin/staff', body),
  updateStaff: (id: string, body: unknown) => patch<StaffRow>(`/admin/staff/${id}`, body),

  auditLogs: (qs = '') => get<Paginated<AuditLogRow>>(`/admin/audit-logs${qs}`),

  settings: () => get<SettingsResponse>('/admin/settings'),
  updateSetting: (key: string, value: unknown) => patch(`/admin/settings/${key}`, { value }),

  broadcast: (body: {
    message: string;
    imageUrl?: string;
    withStoreButton?: boolean;
    segment?: CustomerSegment;
  }) =>
    post<{ sent: number }>('/admin/notifications/broadcast', body),

  roles: () => get<Array<{ role: string; permissions: string[] }>>('/rbac/roles'),

  socialRewardsPending: () => get<AdminSocialReward[]>('/admin/gifts/social-rewards/pending'),
  approveSocialReward: (id: string) => post(`/admin/gifts/social-rewards/${id}/approve`),
  rejectSocialReward: (id: string, reason: string) =>
    post(`/admin/gifts/social-rewards/${id}/reject`, { reason }),
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
  images: string[];
  activationInstructions: string | null;
  deliveryTemplateId: string | null;
  giftType: string | null;
  maxGiftClaims: number | null;
  badge: string | null;
  socialPostUrl: string | null;
  socialPageUrl: string | null;
  ratingScore: string | null;
  reviewCount: number;
  costPrice: string | null;
  bundles?: ProductBundle[];
  category?: { id: string; name: string } | null;
  deliveryTemplate?: { id: string; name: string } | null;
}

export interface ProductBundle {
  id?: string;
  label: string | null;
  quantity: number;
  price: string | number;
  wholesaleOnly: boolean;
  active: boolean;
}

export interface ProfitFigures {
  revenue: string;
  cost: string;
  profit: string;
  margin: number | null;
  orders: number;
  units: number;
}

export interface ProfitReport {
  currency: string;
  from: string;
  to: string;
  totals: ProfitFigures & {
    averageOrder: string;
    refunds: { count: number; amount: string };
    costCoverage: number;
    otherCurrencyOrders: number;
    walletLiability: string;
  };
  daily: Array<ProfitFigures & { date: string }>;
  products: Array<ProfitFigures & { id: string; name: string }>;
  customers: Array<ProfitFigures & { id: string; name: string; merchant: boolean }>;
  channels: Array<ProfitFigures & { name: string }>;
}

export interface WalletTopUp {
  id: string;
  amount: string;
  currency: string;
  payAmount: string | null;
  payCurrency: string | null;
  senderReference: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  customer: {
    id: string;
    firstName: string | null;
    fullName: string | null;
    telegramUsername: string | null;
    contactPhone: string | null;
    walletBalance: string;
  };
  paymentMethod: { id: string; name: string } | null;
  reviewedBy: { id: string; name: string } | null;
}

export interface WalletEntry {
  id: string;
  type: 'TOPUP' | 'PURCHASE' | 'REFUND' | 'ADJUSTMENT';
  amount: string;
  balanceAfter: string;
  currency: string;
  note: string | null;
  createdAt: string;
  order: { id: string; sequenceNumber: number } | null;
  staff: { id: string; name: string } | null;
}

export interface CustomerWallet {
  balance: string;
  currency: string;
  member: boolean;
  entries: WalletEntry[];
}

export interface BundleInput {
  label: string | null;
  quantity: number;
  price: number;
  wholesaleOnly: boolean;
  active: boolean;
}

export interface SavedBundle {
  id: string;
  label: string | null;
  quantity: number;
  price: string;
  wholesaleOnly: boolean;
  active: boolean;
}

export interface Appeal {
  id: string;
  message: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  response: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    telegramUsername: string | null;
    status: string;
    banReason: string | null;
    suspendedUntil: string | null;
    suspendReason: string | null;
  };
}

export interface WholesaleApplication {
  id: string;
  businessName: string;
  contactPhone: string;
  monthlyVolume: string | null;
  notes: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  staffNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  customer: { id: string; firstName: string | null; lastName: string | null; telegramUsername: string | null; wholesaleAt: string | null };
}

export interface CustomerStrike {
  id: string;
  source: string;
  reason: string;
  action: string;
  suspendedUntil: string | null;
  createdAt: string;
}

export interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  status: string;
  displayOrder: number;
  _count?: { products: number };
}

export interface DeliveryTemplate {
  id: string;
  name: string;
  content: string;
  message: string | null;
  _count?: { products: number };
}

export interface BotStatus {
  configured: boolean;
  ready: boolean;
  username: string | null;
  name: string | null;
  miniAppUrl: string;
  webhookUrlConfigured: boolean;
  webhook: {
    url: string;
    pendingUpdateCount: number;
    lastErrorMessage: string | null;
    lastErrorDate: string | null;
  } | null;
  description: string;
  shortDescription: string;
  error: string | null;
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
  walletPaid?: boolean;
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
  customer?: { id: string; firstName: string | null; telegramUsername: string | null };
  paymentMethod?: { id: string; name: string } | null;
}

export interface AdminOrderDetail extends Omit<AdminOrder, 'customer' | 'paymentMethod' | 'items'> {
  subtotal: string;
  /** Member discount + coupon; `total = subtotal - discountTotal`. */
  discountTotal: string;
  memberDiscount: string;
  memberDiscountKind: 'VERIFIED' | 'WELCOME' | null;
  couponCode: string | null;
  /** What the customer transfers when the method's currency differs. */
  payCurrency: string | null;
  payAmount: string | null;
  exchangeRate: string | null;
  cancelReason: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
  items: Array<{
    id: string;
    productId: string;
    productNameSnapshot: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string | null;
    bundleLabel: string | null;
    product: { id: string; slug: string; images: string[] };
  }>;
  customer: {
    id: string;
    telegramId: string;
    firstName: string | null;
    lastName: string | null;
    telegramUsername: string | null;
    status: string;
    verifiedAt: string | null;
    fullName: string | null;
    contactPhone: string | null;
  };
  paymentMethod: PaymentMethod | null;
  paymentProofs: Array<{
    id: string;
    status: string;
    senderReference: string | null;
    mimeType: string;
    uploadedAt: string;
    rejectionReason: string | null;
    reviewedAt: string | null;
    reviewedBy: { name: string } | null;
  }>;
  events: Array<{
    id: string;
    type: string;
    fromStatus: string | null;
    toStatus: string | null;
    actorType: string;
    note: string | null;
    createdAt: string;
    actorStaff: { name: string } | null;
  }>;
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
  enabled: boolean;
  displayOrder: number;
  provider?: PaymentProvider;
  cryptoAsset?: string | null;
  cryptoNetwork?: string | null;
  depositAddress?: string | null;
  watchTtlMinutes?: number;
}

export interface CryptoProviderStatus {
  provider: PaymentProvider;
  /** False when the server has no API key for it — nothing is polled. */
  configured: boolean;
}

export interface CryptoWatch {
  id: string;
  orderId: string;
  orderNumber: number;
  orderStatus: string;
  provider: PaymentProvider;
  asset: string;
  network: string;
  address: string;
  expectedAmount: string;
  orderTotal: string;
  status: 'WAITING' | 'MATCHED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
  matchedAt: string | null;
  createdAt: string;
}

export interface CryptoNearMiss {
  watchId: string;
  orderId: string;
  orderNumber: number;
  expectedAmount: string;
  /** Signed: positive when the customer sent more than was asked. */
  difference: string;
}

export interface CryptoDeposit {
  id: string;
  provider: PaymentProvider;
  txId: string;
  asset: string;
  network: string;
  amount: string;
  address: string | null;
  seenAt: string;
  creditedAt: string | null;
  /** When staff were told this one matched nothing. */
  alertedAt: string | null;
  orderId: string | null;
  orderNumber: number | null;
  matchedByStaffId: string | null;
  /** Orders whose expected amount is within 1% — empty once credited. */
  suggestions: CryptoNearMiss[];
}

export interface CryptoPollSummary {
  ingested: number;
  settled: number;
  expired: number;
  alerted: number;
  errors: string[];
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
  senderReference: string | null;
  order?: { sequenceNumber: number; total: string; currency: string; status: string };
  customer?: { firstName: string | null; telegramUsername: string | null };
  risk?: ProofRisk;
}

/** Computed by the API: a reused screenshot, past rejections, a brand-new account. */
export interface ProofRisk {
  duplicates: Array<{ orderId: string; sequenceNumber: number; sameCustomer: boolean }>;
  previousRejections: number;
  paidOrders: number;
  accountAgeHours: number;
  flags: string[];
}

export interface DeletedOrder {
  id: string;
  sequenceNumber: number;
  restocked: boolean;
}

export interface LegacyCustomer {
  id: string;
  phone: string;
  name: string | null;
  /** null = the Settings percentage. */
  discountPercent: number | null;
  claimedById: string | null;
  claimedAt: string | null;
  createdAt: string;
  claimedBy?: { id: string; firstName: string | null; lastName: string | null; telegramUsername: string | null } | null;
}

export interface LegacyCustomerList {
  total: number;
  claimed: number;
  items: LegacyCustomer[];
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
  orderItem: {
    productNameSnapshot: string;
    quantity: number;
    product?: { id: string; deliveryTemplateId: string | null; activationInstructions: string | null };
  };
  order?: {
    sequenceNumber: number;
    customer?: { firstName: string | null; telegramUsername: string | null };
  };
  deliveredByStaff?: { id: string; name: string } | null;
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
  /** Set once a customer's first order is paid — the "verified" tier. */
  verifiedAt: string | null;
  createdAt: string;
  _count: { orders: number; supportTickets: number };
  paidOrders: number;
  totalSpent: string;
}

export interface AdminCustomerDetail extends Omit<AdminCustomer, '_count'> {
  welcomeGiftOrderId: string | null;
  /** Shared from the customer's own Telegram account. */
  phone: string | null;
  bannedAt: string | null;
  banReason: string | null;
  fullName: string | null;
  contactPhone: string | null;
  wholesaleAt: string | null;
  suspendedUntil: string | null;
  suspendReason: string | null;
  strikes: CustomerStrike[];
  appeals: Array<{ id: string; message: string; status: string; response: string | null; createdAt: string }>;
  wholesaleApplications: Array<{ id: string; businessName: string; status: string; createdAt: string }>;
  legacyEntry: { id: string; phone: string; name: string | null; discountPercent: number | null; claimedAt: string | null } | null;
  rejectedProofs: number;
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

export interface SettingDefinitionRow {
  key: string;
  group: SettingGroup;
  label: string;
  help?: string;
  type: 'text' | 'textarea' | 'boolean' | 'number';
  default: string | number | boolean;
  placeholders?: string[];
  min?: number;
  max?: number;
  value: unknown;
  updatedAt: string | null;
}

export interface SettingsResponse {
  settings: SettingDefinitionRow[];
  custom: Array<{ key: string; value: unknown; updatedAt: string }>;
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

export interface Coupon {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: string;
  minSubtotal: string | null;
  maxDiscount: string | null;
  maxRedemptions: number | null;
  perCustomerLimit: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  timesRedeemed: number;
  createdAt: string;
}

export interface CouponInput {
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotal?: number;
  maxDiscount?: number;
  maxRedemptions?: number;
  perCustomerLimit?: number;
  startsAt?: string;
  endsAt?: string;
  active?: boolean;
}

export interface RevenueReport {
  days: number;
  from: string;
  to: string;
  revenue: string;
  orders: number;
  discountsGiven: string;
  averageOrderValue: string;
  previous: { revenue: string; orders: number };
  /** Null when the previous period had no revenue to compare against. */
  changePercent: number | null;
  byDay: Array<{ day: string; revenue: string; orders: number }>;
  topProducts: Array<{ productId: string; name: string; units: number; revenue: string }>;
}

export interface StaffTelegramLink {
  linked: boolean;
  notify: boolean;
}

export interface AdminSocialReward {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  claimType: 'FACEBOOK_COMMENT' | 'FACEBOOK_RATING';
  facebookPostUrl: string | null;
  facebookProfileUrl: string | null;
  proofScreenshots: string[];
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  product: { id: string; name: string; images: string[] };
  customer: { id: string; firstName: string | null; telegramUsername: string | null };
  reviewer: { id: string; name: string } | null;
}
