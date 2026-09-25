import { Injectable, Logger } from '@nestjs/common';
import { Subject, filter, map, type Observable } from 'rxjs';
import type { NotificationJob } from './notification-dispatcher.service';

interface RealtimeEnvelope {
  audience: 'STAFF' | 'CUSTOMER';
  customerId?: string;
  payload: NotificationJob;
}

/**
 * Server-Sent Events fan-out for open dashboards/Mini App sessions.
 *
 * Deliberately in-process and best-effort: SSE is a live convenience layer
 * over state that is already durable in Postgres, so a client that missed
 * an event while disconnected just re-reads on its next fetch. Anything
 * that must survive a restart goes through the notifications queue instead,
 * not through here.
 *
 * NOTE for horizontal scaling: with multiple API instances a client only
 * receives events raised on the instance it is connected to. Phase 13 adds
 * a Redis pub/sub bridge so every instance sees every event.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly stream = new Subject<RealtimeEnvelope>();

  publishToStaff(payload: NotificationJob): void {
    this.stream.next({ audience: 'STAFF', payload });
  }

  publishToCustomer(customerId: string, payload: NotificationJob): void {
    this.stream.next({ audience: 'CUSTOMER', customerId, payload });
  }

  /** Staff see every staff-audience event. */
  staffStream(): Observable<{ data: NotificationJob }> {
    return this.stream.pipe(
      filter((e) => e.audience === 'STAFF'),
      map((e) => ({ data: e.payload })),
    );
  }

  /** A customer only ever sees events addressed to them. */
  customerStream(customerId: string): Observable<{ data: NotificationJob }> {
    return this.stream.pipe(
      filter((e) => e.audience === 'CUSTOMER' && e.customerId === customerId),
      map((e) => ({ data: e.payload })),
    );
  }
}
