import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { CustomerModerationService } from './customer-moderation.service';

export type StrikeSource = 'DUPLICATE_PROOF' | 'PROOF_REJECTED' | 'PROOF_ATTEMPTS' | 'ORDER_SPAM' | 'MANUAL';

export interface StrikeOutcome {
  action: 'SUSPEND' | 'BAN';
  strikeNumber: number;
  until: Date | null;
}

export const MAX_APPEAL_LENGTH = 1500;

export function isSuspended(customer: Pick<Customer, 'suspendedUntil'>, now = new Date()): boolean {
  return customer.suspendedUntil !== null && customer.suspendedUntil > now;
}

/** True when the customer may not buy, upload proofs, or use the bot. */
export function isRestricted(customer: Pick<Customer, 'status' | 'suspendedUntil'>): boolean {
  return customer.status !== 'ACTIVE' || isSuspended(customer);
}

export function formatUntil(date: Date): string {
  return date.toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The strike ladder. Every suspicious payment event is a strike; strikes
 * inside the window escalate: a short suspension, a longer one, then a
 * permanent ban. A restricted customer can file one appeal at a time and
 * staff decide it.
 *
 * Strikes for one customer are serialised with an advisory lock, so two
 * suspicious uploads landing together count as strikes 1 and 2 — never
 * both as strike 1.
 */
@Injectable()
export class CustomerSecurityService {
  private readonly logger = new Logger(CustomerSecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly moderation: CustomerModerationService,
    private readonly notifications: NotificationDispatcher,
    private readonly audit: AuditService,
  ) {}

  async recordStrike(customerId: string, source: StrikeSource, reason: string): Promise<StrikeOutcome> {
    const [windowHours, firstMinutes, secondHours, banAt] = await Promise.all([
      this.settings.getNumber('security.strikeWindowHours'),
      this.settings.getNumber('security.firstSuspendMinutes'),
      this.settings.getNumber('security.secondSuspendHours'),
      this.settings.getNumber('security.banAfterStrikes'),
    ]);
    const since = new Date(Date.now() - windowHours * 3_600_000);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`strike:${customerId}`}))`;
      const recent = await tx.customerStrike.count({ where: { customerId, createdAt: { gte: since } } });
      const strikeNumber = recent + 1;

      if (strikeNumber >= banAt) {
        await tx.customerStrike.create({ data: { customerId, source, reason, action: 'BAN' } });
        return { action: 'BAN', strikeNumber, until: null } satisfies StrikeOutcome;
      }

      // Each strike past the second doubles the long suspension.
      const minutes =
        strikeNumber === 1 ? firstMinutes : secondHours * 60 * 2 ** Math.max(0, strikeNumber - 2);
      const until = new Date(Date.now() + minutes * 60_000);
      const current = await tx.customer.findUniqueOrThrow({
        where: { id: customerId },
        select: { suspendedUntil: true },
      });
      const effective = current.suspendedUntil && current.suspendedUntil > until ? current.suspendedUntil : until;
      await tx.customerStrike.create({
        data: { customerId, source, reason, action: 'SUSPEND', suspendedUntil: effective },
      });
      await tx.customer.update({
        where: { id: customerId },
        data: { suspendedUntil: effective, suspendReason: reason },
      });
      return { action: 'SUSPEND', strikeNumber, until: effective } satisfies StrikeOutcome;
    });

    this.logger.warn(`Strike ${outcome.strikeNumber} (${source}) on ${customerId}: ${outcome.action}`);

    if (outcome.action === 'BAN') {
      await this.moderation.ban(customerId, null, `${reason} — تكرار المخالفة`);
      await this.notifications.notifyCustomer(customerId, {
        kind: 'customer.restricted',
        summary:
          `🚫 تم إيقاف حسابك نهائياً بسبب تكرار محاولات دفع مريبة.\nالسبب: ${reason}\n\n` +
          'لو شايف إن ده غلط تقدر تقدّم التماس من البوت.',
      });
    } else {
      await this.notifications.notifyCustomer(customerId, {
        kind: 'customer.restricted',
        summary: `⏸️ حسابك موقوف مؤقتاً لحد ${formatUntil(outcome.until!)}.\nالسبب: ${reason}`,
        body: 'تكرار المحاولة في نفس اليوم بيطوّل الإيقاف أو بيخليه نهائي. لو ده غلط قدّم التماس من البوت.',
      });
    }
    await this.notifications.notifyStaff({
      kind: 'customer.strike',
      customerId,
      summary: `🛡️ مخالفة رقم ${outcome.strikeNumber} — ${reason}`,
      action: outcome.action,
    });
    return outcome;
  }

  /**
   * Called before checkout. Too many unpaid orders in an hour is someone
   * fishing for payment details or holding stock; refuse and strike.
   */
  async assertCanOpenOrder(customerId: string): Promise<void> {
    const max = await this.settings.getNumber('security.maxUnpaidOrdersPerHour');
    const unpaid = await this.prisma.order.count({
      where: {
        customerId,
        paidAt: null,
        total: { gt: 0 },
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    if (unpaid < max) return;
    await this.recordStrike(customerId, 'ORDER_SPAM', `فتح ${unpaid + 1} طلبات من غير دفع في ساعة واحدة`);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'TOO_MANY_UNPAID_ORDERS',
        message: 'عندك طلبات كتير من غير دفع. ادفع طلب موجود أو استنى شوية قبل ما تعمل طلب جديد.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // ---------------------------------------------------------------------------
  // Staff actions
  // ---------------------------------------------------------------------------

  async suspend(customerId: string, staffId: string, hours: number, reason: string) {
    const until = new Date(Date.now() + hours * 3_600_000);
    const why = reason.trim().slice(0, 300) || 'قرار الإدارة';
    await this.prisma.$transaction([
      this.prisma.customer.update({ where: { id: customerId }, data: { suspendedUntil: until, suspendReason: why } }),
      this.prisma.customerStrike.create({
        data: { customerId, source: 'MANUAL', reason: why, action: 'SUSPEND', suspendedUntil: until },
      }),
    ]);
    await this.audit.log({
      actorStaffId: staffId,
      action: 'customer.suspended',
      entityType: 'customer',
      entityId: customerId,
      changes: { until: until.toISOString(), reason: why },
    });
    await this.notifications.notifyCustomer(customerId, {
      kind: 'customer.restricted',
      summary: `⏸️ حسابك موقوف مؤقتاً لحد ${formatUntil(until)}.\nالسبب: ${why}`,
    });
    return { suspendedUntil: until };
  }

  /** Lifts a suspension and forgets the strikes, so the next one starts the ladder over. */
  async lift(customerId: string, staffId: string | null) {
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id: customerId },
        data: { suspendedUntil: null, suspendReason: null },
      }),
      this.prisma.customerStrike.deleteMany({ where: { customerId } }),
    ]);
    await this.audit.log({
      actorStaffId: staffId ?? undefined,
      action: 'customer.suspension_lifted',
      entityType: 'customer',
      entityId: customerId,
    });
  }

  listStrikes(customerId: string) {
    return this.prisma.customerStrike.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ---------------------------------------------------------------------------
  // Appeals
  // ---------------------------------------------------------------------------

  async submitAppeal(customerId: string, message: string) {
    const text = message.trim();
    if (text.length < 5) throw new BadRequestException('اكتب تفاصيل أكتر عن اللي حصل.');
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (!isRestricted(customer)) throw new BadRequestException('حسابك مش موقوف.');

    const pending = await this.prisma.customerAppeal.findFirst({ where: { customerId, status: 'PENDING' } });
    if (pending) throw new ConflictException('عندك التماس قيد المراجعة بالفعل. هنرد عليك قريب.');

    const appeal = await this.prisma.customerAppeal.create({
      data: { customerId, message: text.slice(0, MAX_APPEAL_LENGTH) },
    });
    await this.notifications.notifyStaff({
      kind: 'appeal.created',
      appealId: appeal.id,
      customerId,
      summary: `📝 التماس جديد من ${customer.firstName ?? 'عميل'}${customer.telegramUsername ? ` (@${customer.telegramUsername})` : ''}`,
      body: text.slice(0, 600),
    });
    return appeal;
  }

  listAppeals(status?: 'PENDING' | 'ACCEPTED' | 'REJECTED') {
    return this.prisma.customerAppeal.findMany({
      where: status ? { status } : {},
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            telegramUsername: true,
            status: true,
            banReason: true,
            suspendedUntil: true,
            suspendReason: true,
          },
        },
        reviewedBy: { select: { name: true } },
      },
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 100,
    });
  }

  async reviewAppeal(appealId: string, staffId: string, accept: boolean, response?: string) {
    const reply = response?.trim().slice(0, 500) || null;
    const claimed = await this.prisma.customerAppeal.updateMany({
      where: { id: appealId, status: 'PENDING' },
      data: {
        status: accept ? 'ACCEPTED' : 'REJECTED',
        response: reply,
        reviewedById: staffId,
        reviewedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new ConflictException('الالتماس ده اتراجع خلاص.');
    const appeal = await this.prisma.customerAppeal.findUniqueOrThrow({ where: { id: appealId } });

    if (accept) {
      await this.moderation.unban(appeal.customerId, staffId);
      await this.lift(appeal.customerId, staffId);
    }
    await this.notifications.notifyCustomer(appeal.customerId, {
      kind: 'appeal.reviewed',
      summary: accept
        ? '✅ تم قبول الالتماس ورجّعنا حسابك. أهلاً بيك تاني 💙'
        : '❌ تم رفض الالتماس، والإيقاف مستمر.',
      body: reply ? `رد الإدارة: ${reply}` : undefined,
    });
    return appeal;
  }
}
