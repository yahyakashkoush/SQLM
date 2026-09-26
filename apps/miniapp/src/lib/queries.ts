import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthStore } from '@/store/auth-store';

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: api.listCategories });
}

export function useProducts(
  params: { category?: string; search?: string; featured?: boolean } = {},
) {
  return useQuery({
    queryKey: ['products', params],
    queryFn: () => api.listProducts(params),
  });
}

export function useProduct(slug: string) {
  return useQuery({
    queryKey: ['product', slug],
    queryFn: () => api.getProduct(slug),
    enabled: Boolean(slug),
  });
}

export function usePaymentMethods() {
  return useQuery({ queryKey: ['payment-methods'], queryFn: api.listPaymentMethods });
}

export function useOrders() {
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));
  return useQuery({ queryKey: ['orders'], queryFn: api.listOrders, enabled: hasSession });
}

const OPEN_STATUSES = new Set(['CREATED', 'PENDING_PAYMENT', 'PAYMENT_SUBMITTED', 'PAYMENT_REVIEW', 'PAID', 'PROCESSING', 'READY_FOR_DELIVERY']);

export function useOrder(id: string) {
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api.getOrder(id),
    enabled: hasSession && Boolean(id),
    // Keep the page live while the order is still moving (payment review, delivery).
    refetchInterval: (query) => (OPEN_STATUSES.has(query.state.data?.status ?? '') ? 8000 : false),
  });
}

export function useDeliveries(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['deliveries', orderId],
    queryFn: () => api.getDeliveries(orderId),
    enabled,
    refetchInterval: 10_000,
  });
}

export function useStoreInfo() {
  return useQuery({ queryKey: ['store'], queryFn: api.storeInfo, staleTime: 5 * 60_000 });
}

export function useTickets() {
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));
  return useQuery({ queryKey: ['tickets'], queryFn: api.listTickets, enabled: hasSession });
}

export function useTicket(id: string | null) {
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));
  return useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.getTicket(id!),
    enabled: hasSession && Boolean(id),
    refetchInterval: 8000,
  });
}
