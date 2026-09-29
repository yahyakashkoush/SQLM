import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { renderTemplate } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from './phone';

export const MAX_IMPORT_LINES = 5000;

export type ClaimOutcome =
  | { status: 'CLAIMED'; percent: number; message: string }
  | { status: 'ALREADY_CLAIMED'; percent: number }
  | { status: 'NOT_FOUND' }
  | { status: 'TAKEN' }
  | { status: 'INVALID' };

export interface ImportResult {
  added: number;
  updated: number;
  invalid: string[];
}

/**
 * The store's customers from before this platform, by phone number.
 *
 * A number is claimed only through Telegram's contact-share button, and
 * only when the shared contact is the sender's own account — so nobody
 * can claim a discount by typing a number they happen to know. A number
 * is claimed once, by one Telegram account, ever (unique `claimedById`).
 */
@Injectable()
export class LegacyCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async list(search?: string) {
    const term = search?.trim();
    const digits = term?.replace(/\D/g, '');
    const entries = await this.prisma.legacyCustomer.findMany({
      where: term
        ? {
            OR: [
              ...(digits ? [{ phone: { contains: digits } }] : []),
              { name: { contains: term, mode: 'insensitive' as const } },
            ],
          }
        : undefined,
      include: {
        claimedBy: { select: { id: true, firstName: true, lastName: true, telegramUsername: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const [total, claimed] = await Promise.all([
      this.prisma.legacyCustomer.count(),
      this.prisma.legacyCustomer.count({ where: { claimedById: { not: null } } }),
    ]);
    return {
      total,
      claimed,
      items: entries.map((e) => ({ ...e, discountPercent: e.discountPercent?.toNumber() ?? null })),
    };
  }

  /**
   * One customer per line: `phone`, optionally followed by a name and a
   * percentage, separated by commas or tabs (a spreadsheet column pastes
   * as-is). Re-importing a number updates its name/percentage and never
   * touches who claimed it.
   */
  async import(text: string, staffId: string): Promise<ImportResult> {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > MAX_IMPORT_LINES) {
      throw new BadRequestException(`At most ${MAX_IMPORT_LINES} lines per import`);
    }
    const result: ImportResult = { added: 0, updated: 0, invalid: [] };
    for (const line of lines) {
      const [rawPhone = '', rawName, rawPercent] = line.split(/[,\t;]/).map((p) => p.trim());
      const phone = normalizePhone(rawPhone);
      const percent = rawPercent ? Number(rawPercent.replace('%', '')) : undefined;
      if (!phone || (percent !== undefined && (!Number.isFinite(percent) || percent < 0 || percent > 90))) {
        result.invalid.push(line);
        continue;
      }
      const data = {
        ...(rawName ? { name: rawName.slice(0, 100) } : {}),
        ...(percent !== undefined ? { discountPercent: new Prisma.Decimal(percent) } : {}),
      };
      const existing = await this.prisma.legacyCustomer.findUnique({ where: { phone }, select: { id: true } });
      if (existing) {
        if (Object.keys(data).length > 0) await this.prisma.legacyCustomer.update({ where: { phone }, data });
        result.updated++;
      } else {
        await this.prisma.legacyCustomer.create({ data: { phone, ...data } });
        result.added++;
      }
    }
    await this.audit.log({
      actorStaffId: staffId,
      action: 'legacy_customers.imported',
      entityType: 'legacy_customer',
      entityId: 'bulk',
      changes: { added: result.added, updated: result.updated, invalid: result.invalid.length },
    });
    return result;
  }

  async update(id: string, data: { name?: string | null; discountPercent?: number | null }) {
    await this.findOrThrow(id);
    const updated = await this.prisma.legacyCustomer.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name?.trim().slice(0, 100) || null } : {}),
        ...(data.discountPercent !== undefined
          ? { discountPercent: data.discountPercent === null ? null : new Prisma.Decimal(data.discountPercent) }
          : {}),
      },
    });
    return { ...updated, discountPercent: updated.discountPercent?.toNumber() ?? null };
  }

  async remove(id: string, staffId: string): Promise<void> {
    const entry = await this.findOrThrow(id);
    await this.prisma.legacyCustomer.delete({ where: { id } });
    await this.audit.log({
      actorStaffId: staffId,
      action: 'legacy_customer.deleted',
      entityType: 'legacy_customer',
      entityId: id,
      changes: { phone: entry.phone, claimedById: entry.claimedById },
    });
  }

  /** Detaches a claim, e.g. when the wrong Telegram account got it. */
  async release(id: string, staffId: string) {
    await this.findOrThrow(id);
    await this.prisma.legacyCustomer.update({ where: { id }, data: { claimedById: null, claimedAt: null } });
    await this.audit.log({ actorStaffId: staffId, action: 'legacy_customer.released', entityType: 'legacy_customer', entityId: id });
  }

  /** The offer is shown only while the owner has set a percentage. */
  async offerPercent(): Promise<number> {
    return this.settings.getNumber('customers.legacyDiscountPercent');
  }

  async offerMessage(customerName: string | null): Promise<string> {
    const [template, store, percent] = await Promise.all([
      this.settings.getString('customers.legacyOfferMessage'),
      this.settings.storeValues(),
      this.offerPercent(),
    ]);
    return renderTemplate(template, { ...store, percent, customer_name: customerName ?? '' });
  }

  /**
   * `phone` must come from a Telegram contact the caller has already
   * checked belongs to this customer's own account.
   */
  async claim(customerId: string, rawPhone: string, customerName: string | null): Promise<ClaimOutcome> {
    const phone = normalizePhone(rawPhone);
    if (!phone) return { status: 'INVALID' };

    // Remember the verified number either way — it helps support find them.
    await this.prisma.customer.update({ where: { id: customerId }, data: { phone } });

    const mine = await this.prisma.legacyCustomer.findUnique({ where: { claimedById: customerId } });
    if (mine) return { status: 'ALREADY_CLAIMED', percent: await this.percentFor(mine.discountPercent) };

    const entry = await this.prisma.legacyCustomer.findUnique({ where: { phone } });
    if (!entry) return { status: 'NOT_FOUND' };
    if (entry.claimedById && entry.claimedById !== customerId) return { status: 'TAKEN' };

    // Conditional: two accounts sharing the same number at once cannot both win.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const won = await tx.legacyCustomer.updateMany({
        where: { id: entry.id, claimedById: null },
        data: { claimedById: customerId, claimedAt: new Date() },
      });
      if (won.count === 0) return false;
      // They bought from the store before: they count as verified here too.
      await tx.customer.updateMany({ where: { id: customerId, verifiedAt: null }, data: { verifiedAt: new Date() } });
      return true;
    });
    if (!claimed) return { status: 'TAKEN' };

    const percent = await this.percentFor(entry.discountPercent);
    const [template, store] = await Promise.all([
      this.settings.getString('customers.legacyWelcomeMessage'),
      this.settings.storeValues(),
    ]);
    return {
      status: 'CLAIMED',
      percent,
      message: renderTemplate(template, { ...store, percent, customer_name: customerName ?? '' }),
    };
  }

  private async percentFor(own: Prisma.Decimal | null): Promise<number> {
    return own !== null ? own.toNumber() : this.offerPercent();
  }

  private async findOrThrow(id: string) {
    const entry = await this.prisma.legacyCustomer.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Old customer not found');
    return entry;
  }
}
