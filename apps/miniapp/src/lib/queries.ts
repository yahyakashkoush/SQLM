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

export function useOrder(id: string) {
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api.getOrder(id),
    enabled: hasSession && Boolean(id),
  });
}
