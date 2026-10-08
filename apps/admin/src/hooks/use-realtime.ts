'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth-store';

export interface RealtimeEvent {
  kind: string;
  summary: string;
  orderId?: string;
  ticketId?: string;
  productId?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Which query keys a given event invalidates, so open tables refresh themselves. */
const INVALIDATES: Record<string, string[]> = {
  'order.created': ['orders', 'stats'],
  'order.status_changed': ['orders', 'stats'],
  'payment.submitted': ['payment-proofs', 'stats'],
  'payment.reviewed': ['payment-proofs', 'orders', 'stats'],
  'delivery.completed': ['deliveries', 'orders', 'stats'],
  'delivery.failed': ['deliveries', 'stats'],
  'inventory.low_stock': ['products', 'stats'],
  'support.ticket_created': ['tickets', 'stats'],
  'support.customer_reply': ['tickets', 'ticket', 'stats'],
};

/**
 * Subscribes the dashboard to the staff event stream.
 *
 * EventSource can't send an Authorization header, so the token goes in the
 * query string — acceptable here because it is a short-lived access token
 * over TLS in production, and the endpoint re-validates it server-side like
 * any other. Reconnection is EventSource's own (it retries automatically);
 * any event missed while disconnected is picked up by the next refetch,
 * since SSE is a freshness layer over state that already lives in Postgres.
 */
export function useRealtime(): RealtimeEvent[] {
  const token = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<RealtimeEvent[]>([]);

  useEffect(() => {
    if (!token) return;

    const source = new EventSource(`${API_URL}/api/v1/realtime/staff?access_token=${token}`);

    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data as string) as RealtimeEvent;
        setEvents((prev) => [event, ...prev].slice(0, 30));
        for (const key of INVALIDATES[event.kind] ?? []) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    source.onerror = () => {
      // EventSource reconnects on its own; nothing to do but let it.
    };

    return () => source.close();
  }, [token, queryClient]);

  return events;
}
