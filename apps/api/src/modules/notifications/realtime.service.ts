import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Subject, filter, map, type Observable } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import type { NotificationJob } from './notification-dispatcher.service';

interface RealtimeEnvelope {
  audience: 'STAFF' | 'CUSTOMER';
  customerId?: string;
  payload: NotificationJob;
}

const CHANNEL = 'sqlm:realtime';

/**
 * Server-Sent Events fan-out for open dashboards and Mini App sessions.
 *
 * Events are published to Redis and every API instance re-emits them to its
 * own connected clients, so a dashboard connected to instance A still sees
 * an event raised on instance B — the platform runs multiple stateless API
 * instances behind the proxy, so an in-process-only bus would silently drop
 * most events under real deployment.
 *
 * Delivery is still best-effort by design: SSE is a freshness layer over
 * state that is already durable in Postgres, so a client that was
 * disconnected simply re-reads on its next fetch. Anything that must
 * survive a restart goes through the notifications queue instead.
 */
@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly stream = new Subject<RealtimeEnvelope>();

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.subscribe(CHANNEL, (payload) => {
        this.stream.next(payload as RealtimeEnvelope);
      });
    } catch (err) {
      // A missing fan-out must not stop the API from booting; SSE simply
      // degrades to this instance's own events.
      this.logger.error(
        `Realtime fan-out unavailable: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  publishToStaff(payload: NotificationJob): void {
    void this.emit({ audience: 'STAFF', payload });
  }

  publishToCustomer(customerId: string, payload: NotificationJob): void {
    void this.emit({ audience: 'CUSTOMER', customerId, payload });
  }

  private async emit(envelope: RealtimeEnvelope): Promise<void> {
    try {
      await this.redis.publish(CHANNEL, envelope);
    } catch (err) {
      this.logger.warn(
        `Realtime publish failed, delivering locally only: ${err instanceof Error ? err.message : err}`,
      );
      this.stream.next(envelope);
    }
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
