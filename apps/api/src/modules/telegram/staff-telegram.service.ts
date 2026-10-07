import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import type { Staff } from '@prisma/client';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PaymentProofsService } from '../payments/payment-proofs.service';
import { ProofAlreadyReviewedError } from '../payments/errors/payment-proof.errors';
import { CustomerModerationService } from '../orders/customer-moderation.service';

/** How long a "link my Telegram" link from the dashboard stays usable. */
export const STAFF_LINK_TTL_SECONDS = 10 * 60;
/** How long a tapped "other reason" waits for the reason to be typed. */
const REJECT_REASON_TTL_SECONDS = 5 * 60;

/** Deep-link payload prefix: t.me/<bot>?start=staff_<token>. */
export const STAFF_LINK_PREFIX = 'staff_';

const linkKey = (token: string) => `tg:staff-link:${token}`;
const rejectReasonKey = (chatId: number) => `tg:reject-reason:${chatId}`;

/** Canned rejection reasons offered as buttons; index travels in the callback data. */
export const REJECT_REASONS = [
  'المبلغ المحوّل ناقص',
  'الإيصال مش واضح',
  'التحويل موصلش لحسابنا',
  'الإيصال مش خاص بالطلب ده',
] as const;

/** Sent to the customer and stored as the ban reason. */
export const FAKE_PROOF_REASON = 'إيصال مزيف أو تحويل غير حقيقي';

export type ReviewOutcome =
  | { ok: true; staffName: string }
  | { ok: false; message: string; alreadyReviewed?: boolean };

/**
 * Staff side of the bot: linking a Telegram account to a staff member, and
 * reviewing payments from the phone.
 *
 * Everything a tap in Telegram does goes through the same services the
 * dashboard uses, as the linked staff member, after the same permission
 * check the dashboard's guard makes. A Telegram account is trusted only
 * because a signed-in staff member produced a one-time link and that
 * account opened it — never because of an ID typed into a form.
 */
@Injectable()
export class StaffTelegramService {
  private readonly logger = new Logger(StaffTelegramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly paymentProofs: PaymentProofsService,
    private readonly moderation: CustomerModerationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Telegram ids from TELEGRAM_ADMIN_IDS. The env file is the server's own
   * config, so these act as the store owner without a dashboard link.
   */
  private envAdminIds(): Set<string> {
    const raw = this.config.get<string>('TELEGRAM_ADMIN_IDS') ?? '';
    return new Set(raw.split(',').map((id) => id.trim()).filter((id) => /^\d+$/.test(id)));
  }

  private async ownerStaff(): Promise<Staff | null> {
    return this.prisma.staff.findFirst({
      where: { role: 'OWNER', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Linked staff or an env admin — anyone who gets the admin panel. */
  async isAdminAccount(telegramUserId: number): Promise<boolean> {
    if (this.envAdminIds().has(String(telegramUserId))) return true;
    const staff = await this.prisma.staff.findUnique({
      where: { telegramId: BigInt(telegramUserId) },
      select: { status: true },
    });
    return staff?.status === 'ACTIVE';
  }

  // ---------------------------------------------------------------------------
  // Linking
  // ---------------------------------------------------------------------------

  async createLinkToken(staffId: string): Promise<{ token: string; expiresAt: Date }> {
    // URL-safe and within Telegram's 64-character /start payload limit.
    const token = nanoid(32);
    await this.redis.client.set(linkKey(token), staffId, 'EX', STAFF_LINK_TTL_SECONDS);
    return { token, expiresAt: new Date(Date.now() + STAFF_LINK_TTL_SECONDS * 1000) };
  }

  /**
   * Redeems a link token for the Telegram account that opened it. One use
   * only (GETDEL), so a link forwarded or opened twice cannot attach a
   * second account. A Telegram account moves to the new staff member if
   * it was linked to someone else, since it can only notify one of them.
   */
  async linkFromToken(token: string, telegramUserId: number): Promise<Pick<Staff, 'id' | 'name'> | null> {
    const staffId = await this.redis.client.getdel(linkKey(token));
    if (!staffId) return null;

    const telegramId = BigInt(telegramUserId);
    return this.prisma.$transaction(async (tx) => {
      await tx.staff.updateMany({
        where: { telegramId, id: { not: staffId } },
        data: { telegramId: null },
      });
      const staff = await tx.staff.findUnique({ where: { id: staffId } });
      if (!staff || staff.status !== 'ACTIVE') return null;
      return tx.staff.update({
        where: { id: staffId },
        data: { telegramId, telegramNotify: true },
        select: { id: true, name: true },
      });
    });
  }

  async linkStatus(staffId: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { telegramId: true, telegramNotify: true },
    });
    if (!staff) throw new NotFoundException('Staff not found');
    return { linked: staff.telegramId !== null, notify: staff.telegramNotify };
  }

  async unlink(staffId: string) {
    await this.prisma.staff.update({ where: { id: staffId }, data: { telegramId: null } });
    return this.linkStatus(staffId);
  }

  async setNotify(staffId: string, notify: boolean) {
    await this.prisma.staff.update({ where: { id: staffId }, data: { telegramNotify: notify } });
    return this.linkStatus(staffId);
  }

  async telegramIdOf(staffId: string): Promise<bigint | null> {
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { telegramId: true } });
    return staff?.telegramId ?? null;
  }

  // ---------------------------------------------------------------------------
  // Who gets alerts, and who may act
  // ---------------------------------------------------------------------------

  /** Linked, active staff with alerts on whose role grants `permission`. */
  async recipients(permission: Permission): Promise<Array<Pick<Staff, 'id' | 'telegramId'>>> {
    const staff = await this.prisma.staff.findMany({
      where: { status: 'ACTIVE', telegramNotify: true, telegramId: { not: null } },
      select: { id: true, telegramId: true, role: true },
    });
    const linked = staff.filter((s) => can(s.role as Role, permission));
    const envIds = [...this.envAdminIds()].filter((id) => !staff.some((s) => s.telegramId?.toString() === id));
    if (envIds.length === 0) return linked;
    const owner = await this.ownerStaff();
    if (!owner) return linked;
    return [...linked, ...envIds.map((id) => ({ id: owner.id, telegramId: BigInt(id) }))];
  }

  /** The staff member behind a Telegram account, if linked, active and allowed. */
  async actingStaff(telegramUserId: number, permission: Permission): Promise<Staff | null> {
    const staff = await this.prisma.staff.findUnique({ where: { telegramId: BigInt(telegramUserId) } });
    if (staff) {
      return staff.status === 'ACTIVE' && can(staff.role as Role, permission) ? staff : null;
    }
    if (this.envAdminIds().has(String(telegramUserId))) return this.ownerStaff();
    return null;
  }

  // ---------------------------------------------------------------------------
  // Payment review from Telegram
  // ---------------------------------------------------------------------------

  async approve(telegramUserId: number, proofId: string): Promise<ReviewOutcome> {
    const staff = await this.actingStaff(telegramUserId, 'payments.proofs.review');
    if (!staff) return { ok: false, message: '⛔ حسابك مش مربوط أو مالوش صلاحية مراجعة الدفع.' };
    try {
      await this.paymentProofs.approve(proofId, staff.id);
      this.logger.log(`Proof ${proofId} approved from Telegram by staff ${staff.id}`);
      return { ok: true, staffName: staff.name };
    } catch (err) {
      return this.reviewFailure(err);
    }
  }

  /** Back to PENDING_PAYMENT, so the customer can send a new proof. */
  async reject(telegramUserId: number, proofId: string, reason: string): Promise<ReviewOutcome> {
    const staff = await this.actingStaff(telegramUserId, 'payments.proofs.review');
    if (!staff) return { ok: false, message: '⛔ حسابك مش مربوط أو مالوش صلاحية مراجعة الدفع.' };
    const trimmed = reason.trim().slice(0, 500);
    if (!trimmed) return { ok: false, message: 'اكتب سبب الرفض.' };
    try {
      await this.paymentProofs.reject(proofId, staff.id, trimmed, false);
      this.logger.log(`Proof ${proofId} rejected from Telegram by staff ${staff.id}`);
      return { ok: true, staffName: staff.name };
    } catch (err) {
      return this.reviewFailure(err);
    }
  }

  /**
   * The screenshot is fake: reject it, cancel the order, and ban the
   * customer — which also cancels their other unpaid orders. Needs both
   * review and ban rights, since it does both.
   */
  async rejectAsFake(telegramUserId: number, proofId: string): Promise<ReviewOutcome> {
    const staff = await this.actingStaff(telegramUserId, 'payments.proofs.review');
    if (!staff) return { ok: false, message: '⛔ حسابك مش مربوط أو مالوش صلاحية مراجعة الدفع.' };
    if (!can(staff.role as Role, 'customers.ban')) {
      return { ok: false, message: '⛔ مالكش صلاحية حظر العملاء. ارفض بسبب عادي وبلّغ المالك.' };
    }
    const proof = await this.prisma.paymentProof.findUnique({ where: { id: proofId }, select: { customerId: true } });
    if (!proof) return { ok: false, message: 'الإثبات ده مش موجود.' };
    try {
      await this.paymentProofs.reject(proofId, staff.id, FAKE_PROOF_REASON, true, false);
      await this.moderation.ban(proof.customerId, staff.id, FAKE_PROOF_REASON);
      this.logger.warn(`Proof ${proofId} rejected as fake and customer ${proof.customerId} banned by staff ${staff.id}`);
      return { ok: true, staffName: staff.name };
    } catch (err) {
      return this.reviewFailure(err);
    }
  }

  /** "Other reason": the next text this chat sends is the reason. */
  async armCustomReason(chatId: number, proofId: string): Promise<void> {
    await this.redis.client.set(rejectReasonKey(chatId), proofId, 'EX', REJECT_REASON_TTL_SECONDS);
  }

  /** The proof awaiting a typed reason from this chat, once (GETDEL). */
  async consumeCustomReason(chatId: number): Promise<string | null> {
    try {
      return await this.redis.client.getdel(rejectReasonKey(chatId));
    } catch (err) {
      // Never let a Redis hiccup swallow a customer's message.
      this.logger.error(`Reject-reason lookup failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private reviewFailure(err: unknown): ReviewOutcome {
    if (err instanceof ProofAlreadyReviewedError) {
      return { ok: false, alreadyReviewed: true, message: 'الإثبات ده اتراجع خلاص.' };
    }
    if (err instanceof NotFoundException) return { ok: false, message: 'الإثبات ده مش موجود.' };
    this.logger.error(`Telegram payment review failed: ${err instanceof Error ? err.stack : err}`);
    return { ok: false, message: 'حصلت مشكلة — جرّب تاني أو راجع من لوحة التحكم.' };
  }
}

function can(role: Role, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}
