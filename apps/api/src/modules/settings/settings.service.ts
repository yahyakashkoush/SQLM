import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SETTING_DEFAULTS, SETTING_DEFINITIONS } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Callers inside an interactive transaction must pass their `tx`: a query
 * on the root client there needs a second pool connection while the
 * transaction holds the first, and a burst of concurrent transactions
 * then starves the pool until every one of them times out.
 */
type Db = Pick<Prisma.TransactionClient, 'platformSetting'>;

const CACHE_TTL_MS = 10_000;

/**
 * Read side of `PlatformSetting`, falling back to the shared defaults.
 * Cached briefly per process: the API and worker tiers each hold their own
 * copy, so an edit is visible everywhere within CACHE_TTL_MS.
 */
@Injectable()
export class SettingsService {
  private cache: { values: Record<string, unknown>; loadedAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async all(db: Db = this.prisma): Promise<Record<string, unknown>> {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) return this.cache.values;
    const rows = await db.platformSetting.findMany();
    const values: Record<string, unknown> = { ...SETTING_DEFAULTS };
    for (const row of rows) values[row.key] = row.value;
    this.cache = { values, loadedAt: Date.now() };
    return values;
  }

  async getString(key: string, db?: Db): Promise<string> {
    const value = (await this.all(db))[key];
    if (typeof value === 'string') return value;
    return value === undefined || value === null ? String(SETTING_DEFAULTS[key] ?? '') : String(value);
  }

  async getBoolean(key: string): Promise<boolean> {
    const value = (await this.all())[key];
    if (typeof value === 'boolean') return value;
    if (value === 'false' || value === 0) return false;
    if (value === 'true' || value === 1) return true;
    return Boolean(SETTING_DEFAULTS[key]);
  }

  /** Values commonly substituted into customer-facing templates. */
  async storeValues(db?: Db): Promise<{ store_name: string; support_contact: string }> {
    return {
      store_name: await this.getString('store.name', db),
      support_contact: await this.getString('store.supportContact', db),
    };
  }

  /** Definitions merged with current values, for the admin Settings page. */
  async listForAdmin() {
    const rows = await this.prisma.platformSetting.findMany({ orderBy: { key: 'asc' } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const known = SETTING_DEFINITIONS.map((def) => ({
      ...def,
      value: byKey.has(def.key) ? byKey.get(def.key)!.value : def.default,
      updatedAt: byKey.get(def.key)?.updatedAt ?? null,
    }));
    const knownKeys = new Set(SETTING_DEFINITIONS.map((d) => d.key));
    const custom = rows
      .filter((r) => !knownKeys.has(r.key))
      .map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt }));
    return { settings: known, custom };
  }

  invalidate(): void {
    this.cache = null;
  }
}
