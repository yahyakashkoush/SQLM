import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { Redis as RedisClient } from 'ioredis';

/**
 * Thin wrapper around ioredis exposing the raw client plus the two
 * cross-cutting primitives most modules need: idempotency guards and
 * short-lived distributed locks (used for inventory reservation and
 * duplicate-checkout protection). Keeping these here means every module
 * gets the same retry/backoff behavior instead of hand-rolling Redis calls.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: RedisClient;
  private subscriber?: RedisClient;

  constructor(private readonly config: ConfigService) {
    this.client = this.createClient();
    this.client.on('error', (err) => this.logger.error('Redis connection error', err));
  }

  private createClient(): RedisClient {
    const url = this.config.get<string>('REDIS_URL');
    return url
      ? new Redis(url, { maxRetriesPerRequest: 3 })
      : new Redis({
          host: this.config.get<string>('REDIS_HOST', 'localhost'),
          port: this.config.get<number>('REDIS_PORT', 6379),
          password: this.config.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: 3,
        });
  }

  /**
   * Fan-out across API instances. A connection in subscriber mode can't run
   * normal commands, so subscribing gets its own client, created lazily —
   * the worker tier never subscribes and shouldn't pay for a second
   * connection.
   */
  async publish(channel: string, payload: unknown): Promise<void> {
    await this.client.publish(channel, JSON.stringify(payload));
  }

  async subscribe(channel: string, handler: (payload: unknown) => void): Promise<void> {
    this.subscriber ??= this.createClient();
    this.subscriber.on('error', (err) => this.logger.error('Redis subscriber error', err));

    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (received, message) => {
      if (received !== channel) return;
      try {
        handler(JSON.parse(message));
      } catch {
        this.logger.warn(`Discarding malformed message on ${channel}`);
      }
    });
  }

  /**
   * Atomically claims a one-time key. Returns true the first time it is
   * called for a given key within the TTL window, false on every retry —
   * this is the primitive idempotency (duplicate Telegram updates, double
   * checkout submits, etc.) is built on.
   */
  async claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * Best-effort distributed lock. Returns a release function, or null if
   * the lock is already held. Used to serialize inventory reservation per
   * product alongside the DB-level `FOR UPDATE SKIP LOCKED` so contention
   * fails fast instead of queueing behind a long transaction.
   */
  async acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
    const token = Math.random().toString(36).slice(2);
    const lockKey = `lock:${key}`;
    const acquired = await this.client.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') return null;

    return async () => {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.client.eval(script, 1, lockKey, token);
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.subscriber?.disconnect();
    this.client.disconnect();
  }
}
