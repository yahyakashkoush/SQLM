import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Staff } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Which staff member a Telegram account acts as. One rule, used by the bot's
 * admin panel and by the Mini App's admin mode alike:
 *
 * - an account linked from the dashboard acts as that staff member, while
 *   the member is ACTIVE;
 * - an id in TELEGRAM_ADMIN_IDS (the server's own config) acts as the
 *   store owner — the first active OWNER.
 *
 * Nothing else: a Telegram id typed into a form never grants anything.
 */
@Injectable()
export class StaffIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  envAdminIds(): Set<string> {
    const raw = this.config.get<string>('TELEGRAM_ADMIN_IDS') ?? '';
    return new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id)),
    );
  }

  owner(): Promise<Staff | null> {
    return this.prisma.staff.findFirst({
      where: { role: 'OWNER', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The active staff member behind this Telegram account, or null. */
  async resolve(telegramUserId: number | bigint | string): Promise<Staff | null> {
    const id = String(telegramUserId);
    if (!/^\d+$/.test(id)) return null;
    const linked = await this.prisma.staff.findUnique({ where: { telegramId: BigInt(id) } });
    if (linked) return linked.status === 'ACTIVE' ? linked : null;
    return this.envAdminIds().has(id) ? this.owner() : null;
  }
}
