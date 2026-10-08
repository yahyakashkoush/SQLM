import { Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard, type Bot, type Context } from 'grammy';
import type { Permission } from '@sqlm/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { CustomerSecurityService, formatUntil, isSuspended } from '../orders/customer-security.service';
import { CustomerModerationService } from '../orders/customer-moderation.service';
import { WholesaleService } from '../wholesale/wholesale.service';
import { WalletService } from '../wallet/wallet.service';
import { StaffTelegramService } from './staff-telegram.service';
import { StaffAlertRenderer } from './staff-alert.renderer';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STATE_TTL_SECONDS = 10 * 60;
const stateKey = (chatId: number) => `tg:admin-state:${chatId}`;
const MAX_LISTED = 5;

/** Callback data, all under Telegram's 64-byte limit. */
const CB = {
  home: 'ad:home',
  stats: 'ad:stats',
  proofs: 'ad:proofs',
  appeals: 'ad:appeals',
  wholesale: 'ad:wh',
  topUps: 'ad:tu',
  find: 'ad:find',
  topUpApprove: new RegExp(`^ad:tuA:(${UUID})$`),
  topUpReject: new RegExp(`^ad:tuR:(${UUID})$`),
  appealAccept: new RegExp(`^ad:apA:(${UUID})$`),
  appealReject: new RegExp(`^ad:apR:(${UUID})$`),
  wholesaleApprove: new RegExp(`^ad:whA:(${UUID})$`),
  wholesaleReject: new RegExp(`^ad:whR:(${UUID})$`),
  message: new RegExp(`^ad:msg:(${UUID})$`),
  suspend: new RegExp(`^ad:sus:(${UUID})$`),
  ban: new RegExp(`^ad:ban:(${UUID})$`),
  banConfirm: new RegExp(`^ad:banY:(${UUID})$`),
  lift: new RegExp(`^ad:lift:(${UUID})$`),
};

type PanelState = { step: 'find' } | { step: 'message'; customerId: string };

type CustomerCard = Prisma.CustomerGetPayload<{
  include: { _count: { select: { orders: true } } };
}>;

/**
 * The store's control room inside the bot, for staff with a linked
 * Telegram account (or an id in TELEGRAM_ADMIN_IDS). Every button checks
 * the acting staff member's permission at tap time, exactly like the
 * dashboard's guards — a forwarded message or a stale keyboard grants
 * nothing.
 */
@Injectable()
export class BotAdminPanelService {
  private readonly logger = new Logger(BotAdminPanelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly staffTelegram: StaffTelegramService,
    private readonly renderer: StaffAlertRenderer,
    private readonly security: CustomerSecurityService,
    private readonly moderation: CustomerModerationService,
    private readonly wholesale: WholesaleService,
    private readonly notifications: NotificationDispatcher,
    private readonly wallet: WalletService,
  ) {}

  isAdmin(telegramUserId: number): Promise<boolean> {
    return this.staffTelegram.isAdminAccount(telegramUserId);
  }

  register(bot: Bot): void {
    bot.command('admin', async (ctx) => {
      if (!ctx.from || !(await this.isAdmin(ctx.from.id))) return;
      await this.showHome(ctx);
    });

    bot.callbackQuery(CB.home, (ctx) => this.guard(ctx, 'orders.read', () => this.showHome(ctx, true)));
    bot.callbackQuery(CB.stats, (ctx) => this.guard(ctx, 'analytics.read', () => this.showStats(ctx)));
    bot.callbackQuery(CB.proofs, (ctx) => this.guard(ctx, 'payments.proofs.read', () => this.resendProofs(ctx)));
    bot.callbackQuery(CB.appeals, (ctx) => this.guard(ctx, 'customers.read', () => this.listAppeals(ctx)));
    bot.callbackQuery(CB.wholesale, (ctx) => this.guard(ctx, 'customers.read', () => this.listWholesale(ctx)));
    bot.callbackQuery(CB.topUps, (ctx) => this.guard(ctx, 'payments.proofs.read', () => this.resendTopUps(ctx)));
    bot.callbackQuery(CB.topUpApprove, (ctx) =>
      this.guard(ctx, 'payments.proofs.review', async (staffId) => {
        const result = await this.wallet.review(ctx.match![1]!, staffId, { approve: true });
        await this.markDone(ctx, `✅ اتقبل واتشحن الرصيد. رصيده دلوقتي ${result.balance}.`);
      }),
    );
    bot.callbackQuery(CB.topUpReject, (ctx) =>
      this.guard(ctx, 'payments.proofs.review', async (staffId) => {
        await this.wallet.review(ctx.match![1]!, staffId, {
          approve: false,
          reason: 'التحويل موصلش أو مش مطابق للمبلغ',
        });
        await this.markDone(ctx, '❌ اترفض طلب الشحن.');
      }),
    );
    bot.callbackQuery(CB.find, (ctx) =>
      this.guard(ctx, 'customers.read', async () => {
        await this.setState(ctx, { step: 'find' });
        await ctx.reply('🔎 ابعت يوزر العميل (@user) أو رقم الطلب (#123) أو الـ Telegram ID.');
      }),
    );

    bot.callbackQuery(CB.appealAccept, (ctx) =>
      this.guard(ctx, 'customers.ban', async (staffId) => {
        await this.security.reviewAppeal(ctx.match![1]!, staffId, true);
        await this.markDone(ctx, '✅ اتقبل الالتماس ورجع الحساب.');
      }),
    );
    bot.callbackQuery(CB.appealReject, (ctx) =>
      this.guard(ctx, 'customers.ban', async (staffId) => {
        await this.security.reviewAppeal(ctx.match![1]!, staffId, false);
        await this.markDone(ctx, '❌ اترفض الالتماس.');
      }),
    );
    bot.callbackQuery(CB.wholesaleApprove, (ctx) =>
      this.guard(ctx, 'customers.write', async (staffId) => {
        await this.wholesale.review(ctx.match![1]!, staffId, true);
        await this.markDone(ctx, '✅ اتقبل كتاجر جملة.');
      }),
    );
    bot.callbackQuery(CB.wholesaleReject, (ctx) =>
      this.guard(ctx, 'customers.write', async (staffId) => {
        await this.wholesale.review(ctx.match![1]!, staffId, false);
        await this.markDone(ctx, '❌ اترفض طلب الجملة.');
      }),
    );

    bot.callbackQuery(CB.message, (ctx) =>
      this.guard(ctx, 'customers.write', async () => {
        await this.setState(ctx, { step: 'message', customerId: ctx.match![1]! });
        await ctx.reply('✍️ اكتب الرسالة اللي هتتبعت للعميل من البوت (رسالة واحدة).');
      }),
    );
    bot.callbackQuery(CB.suspend, (ctx) =>
      this.guard(ctx, 'customers.ban', async (staffId) => {
        const { suspendedUntil } = await this.security.suspend(ctx.match![1]!, staffId, 24, 'قرار الإدارة');
        await this.markDone(ctx, `⏸️ اتوقف لحد ${formatUntil(suspendedUntil)}.`);
      }),
    );
    bot.callbackQuery(CB.ban, (ctx) =>
      this.guard(ctx, 'customers.ban', async () => {
        await ctx.editMessageReplyMarkup({
          reply_markup: new InlineKeyboard()
            .text('🚫 أيوه احظره نهائي', `ad:banY:${ctx.match![1]}`)
            .row()
            .text('↩️ لا', CB.home),
        });
      }),
    );
    bot.callbackQuery(CB.banConfirm, (ctx) =>
      this.guard(ctx, 'customers.ban', async (staffId) => {
        const result = await this.moderation.ban(ctx.match![1]!, staffId, 'قرار الإدارة');
        await this.markDone(ctx, `🚫 اتحظر نهائي. اتلغى ${result.cancelledOrders} طلب مش مدفوع.`);
      }),
    );
    bot.callbackQuery(CB.lift, (ctx) =>
      this.guard(ctx, 'customers.ban', async (staffId) => {
        await this.moderation.unban(ctx.match![1]!, staffId);
        await this.security.lift(ctx.match![1]!, staffId);
        await this.markDone(ctx, '✅ اترفع الإيقاف/الحظر.');
      }),
    );
  }

  /** The admin keyboard, under the welcome message for staff. */
  async showHome(ctx: Context, edit = false): Promise<void> {
    const [proofs, appeals, wholesale, topUps] = await Promise.all([
      this.prisma.paymentProof.count({ where: { status: 'PENDING' } }),
      this.prisma.customerAppeal.count({ where: { status: 'PENDING' } }),
      this.prisma.wholesaleApplication.count({ where: { status: 'PENDING' } }),
      this.prisma.walletTopUp.count({ where: { status: 'PENDING' } }),
    ]);
    const keyboard = new InlineKeyboard()
      .text('📊 إحصائيات اليوم', CB.stats)
      .row()
      .text(`🧾 إيصالات مستنية (${proofs})`, CB.proofs)
      .text(`💳 شحن رصيد (${topUps})`, CB.topUps)
      .row()
      .text(`📝 التماسات (${appeals})`, CB.appeals)
      .text(`🏪 طلبات جملة (${wholesale})`, CB.wholesale)
      .row()
      .text('🔎 عميل: رسالة / إيقاف / حظر', CB.find);
    const text = '🛠️ لوحة الأدمن\nكل زرار هنا بيتسجل باسمك في سجل التدقيق.';
    if (edit && ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => ctx.reply(text, { reply_markup: keyboard }));
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  }

  /**
   * Text from an admin in the middle of a panel flow. Returns true when it
   * was consumed, so it does not also land in support.
   */
  async consumeText(ctx: Context, text: string): Promise<boolean> {
    if (!ctx.chat || !ctx.from) return false;
    let raw: string | null;
    try {
      raw = await this.redis.client.getdel(stateKey(ctx.chat.id));
    } catch {
      return false;
    }
    if (!raw) return false;
    const state = JSON.parse(raw) as PanelState;

    if (state.step === 'find') {
      const staff = await this.staffTelegram.actingStaff(ctx.from.id, 'customers.read');
      if (!staff) return true;
      const customer = await this.findCustomer(text);
      if (!customer) {
        await ctx.reply('مش لاقي عميل بالبيانات دي. جرّب يوزر أو رقم طلب تاني.', {
          reply_markup: new InlineKeyboard().text('🔎 بحث تاني', CB.find),
        });
        return true;
      }
      await this.sendCustomerCard(ctx, customer);
      return true;
    }

    const staff = await this.staffTelegram.actingStaff(ctx.from.id, 'customers.write');
    if (!staff) return true;
    const message = text.trim().slice(0, 2000);
    await this.notifications.notifyCustomer(state.customerId, { kind: 'customer.message', summary: message });
    await this.prisma.auditLog.create({
      data: {
        actorStaffId: staff.id,
        action: 'customer.messaged',
        entityType: 'customer',
        entityId: state.customerId,
        changes: { message: message.slice(0, 500), via: 'telegram' },
      },
    });
    await ctx.reply('📨 الرسالة اتبعتت للعميل.');
    return true;
  }

  // ---------------------------------------------------------------------------

  private async guard(
    ctx: Context & { match?: RegExpMatchArray | string },
    permission: Permission,
    action: (staffId: string) => Promise<void>,
  ): Promise<void> {
    const staff = ctx.from ? await this.staffTelegram.actingStaff(ctx.from.id, permission) : null;
    if (!staff) {
      await ctx.answerCallbackQuery({ text: '⛔ مالكش صلاحية للزرار ده.', show_alert: true });
      return;
    }
    try {
      await action(staff.id);
      await ctx.answerCallbackQuery().catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Admin panel action failed: ${message}`);
      await ctx.answerCallbackQuery({ text: message.slice(0, 190), show_alert: true }).catch(() => undefined);
    }
  }

  private async setState(ctx: Context, state: PanelState): Promise<void> {
    if (!ctx.chat) return;
    await this.redis.client.set(stateKey(ctx.chat.id), JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
  }

  private async markDone(ctx: Context, status: string): Promise<void> {
    const message = ctx.callbackQuery?.message;
    if (message && 'text' in message && message.text) {
      await ctx.editMessageText(`${message.text}\n\n${status}`).catch(() => undefined);
    } else {
      await ctx.reply(status);
    }
  }

  private async showStats(ctx: Context): Promise<void> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [orders, paid, revenue, newCustomers, tickets, proofs, strikes] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: since } } }),
      this.prisma.order.count({ where: { paidAt: { gte: since } } }),
      this.prisma.order.aggregate({ where: { paidAt: { gte: since } }, _sum: { total: true } }),
      this.prisma.customer.count({ where: { createdAt: { gte: since } } }),
      this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_ADMIN'] } } }),
      this.prisma.paymentProof.count({ where: { status: 'PENDING' } }),
      this.prisma.customerStrike.count({ where: { createdAt: { gte: since } } }),
    ]);
    await ctx.reply(
      [
        '📊 آخر 24 ساعة',
        '',
        `🛒 طلبات جديدة: ${orders}`,
        `✅ طلبات اتدفعت: ${paid}`,
        `💰 الإيراد: ${revenue._sum.total?.toFixed(2) ?? '0.00'} $`,
        `👥 عملاء جدد: ${newCustomers}`,
        `🧾 إيصالات مستنية مراجعة: ${proofs}`,
        `🎫 تذاكر دعم مفتوحة: ${tickets}`,
        `🛡️ مخالفات أمنية: ${strikes}`,
      ].join('\n'),
      { reply_markup: new InlineKeyboard().text('↩️ اللوحة', CB.home) },
    );
  }

  /** Re-sends pending top-up requests as review alerts, receipt and buttons included. */
  private async resendTopUps(ctx: Context): Promise<void> {
    const topUps = await this.prisma.walletTopUp.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: MAX_LISTED,
      select: { id: true },
    });
    if (topUps.length === 0) {
      await ctx.reply('🎉 مفيش طلبات شحن مستنية.');
      return;
    }
    for (const topUp of topUps) {
      const alert = await this.renderer.render({ kind: 'wallet.topup_requested', audience: 'STAFF', topUpId: topUp.id, summary: '' });
      if (alert) await this.sendAlert(ctx, alert);
    }
  }

  private async sendAlert(ctx: Context, alert: NonNullable<Awaited<ReturnType<StaffAlertRenderer['render']>>>): Promise<void> {
    if (!ctx.chat) return;
    const keyboard = new InlineKeyboard();
    alert.buttons.forEach((row, i) => {
      if (i > 0) keyboard.row();
      for (const button of row) {
        if (button.callbackData) keyboard.text(button.text, button.callbackData);
        else if (button.url) keyboard.url(button.text, button.url);
      }
    });
    if (alert.file) {
      const { InputFile } = await import('grammy');
      const file = new InputFile(alert.file.buffer, alert.file.filename);
      const options = { caption: alert.text, reply_markup: keyboard };
      await (alert.file.asPhoto ? ctx.replyWithPhoto(file, options) : ctx.replyWithDocument(file, options)).catch(() =>
        ctx.reply(alert.text, { reply_markup: keyboard }),
      );
    } else {
      await ctx.reply(alert.text, { reply_markup: keyboard });
    }
  }

  /** Re-sends the oldest pending proofs as normal review alerts, buttons and all. */
  private async resendProofs(ctx: Context): Promise<void> {
    const proofs = await this.prisma.paymentProof.findMany({
      where: { status: 'PENDING' },
      orderBy: { uploadedAt: 'asc' },
      take: MAX_LISTED,
      select: { orderId: true },
    });
    if (proofs.length === 0) {
      await ctx.reply('🎉 مفيش إيصالات مستنية.');
      return;
    }
    for (const proof of proofs) {
      const alert = await this.renderer.render({
        kind: 'payment.submitted',
        audience: 'STAFF',
        orderId: proof.orderId,
        summary: '',
      });
      if (!alert || !ctx.chat) continue;
      const keyboard = new InlineKeyboard();
      alert.buttons.forEach((row, i) => {
        if (i > 0) keyboard.row();
        for (const button of row) {
          if (button.callbackData) keyboard.text(button.text, button.callbackData);
          else if (button.url) keyboard.url(button.text, button.url);
        }
      });
      if (alert.file) {
        const { InputFile } = await import('grammy');
        const file = new InputFile(alert.file.buffer, alert.file.filename);
        const options = { caption: alert.text, reply_markup: keyboard };
        await (alert.file.asPhoto ? ctx.replyWithPhoto(file, options) : ctx.replyWithDocument(file, options)).catch(
          () => ctx.reply(alert.text, { reply_markup: keyboard }),
        );
      } else {
        await ctx.reply(alert.text, { reply_markup: keyboard });
      }
    }
  }

  private async listAppeals(ctx: Context): Promise<void> {
    const appeals = await this.security.listAppeals('PENDING');
    if (appeals.length === 0) {
      await ctx.reply('مفيش التماسات مستنية.');
      return;
    }
    for (const appeal of appeals.slice(0, MAX_LISTED)) {
      const c = appeal.customer;
      const state =
        c.status === 'BANNED'
          ? `🚫 محظور: ${c.banReason ?? '—'}`
          : c.suspendedUntil && c.suspendedUntil > new Date()
            ? `⏸️ موقوف لحد ${formatUntil(c.suspendedUntil)}: ${c.suspendReason ?? '—'}`
            : '✔️ مش موقوف حالياً';
      await ctx.reply(
        [
          `📝 التماس من ${c.firstName ?? '—'}${c.telegramUsername ? ` (@${c.telegramUsername})` : ''}`,
          state,
          '',
          appeal.message,
        ].join('\n'),
        {
          reply_markup: new InlineKeyboard()
            .text('✅ قبول ورفع الإيقاف', `ad:apA:${appeal.id}`)
            .row()
            .text('❌ رفض', `ad:apR:${appeal.id}`),
        },
      );
    }
  }

  private async listWholesale(ctx: Context): Promise<void> {
    const applications = await this.wholesale.list('PENDING');
    if (applications.length === 0) {
      await ctx.reply('مفيش طلبات جملة مستنية.');
      return;
    }
    for (const a of applications.slice(0, MAX_LISTED)) {
      await ctx.reply(
        [
          `🏪 ${a.businessName}`,
          `العميل: ${a.customer.firstName ?? '—'}${a.customer.telegramUsername ? ` (@${a.customer.telegramUsername})` : ''}`,
          `الموبايل: ${a.contactPhone}`,
          a.monthlyVolume ? `الكمية: ${a.monthlyVolume}` : '',
          a.notes ? `ملاحظات: ${a.notes}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        {
          reply_markup: new InlineKeyboard()
            .text('✅ قبول', `ad:whA:${a.id}`)
            .text('❌ رفض', `ad:whR:${a.id}`),
        },
      );
    }
  }

  private async findCustomer(query: string): Promise<CustomerCard | null> {
    const q = query.trim();
    const include = { _count: { select: { orders: true } } } as const;
    const order = /^#?(\d{1,7})$/.exec(q);
    if (order) {
      const found = await this.prisma.order.findUnique({
        where: { sequenceNumber: Number(order[1]) },
        select: { customer: { include } },
      });
      if (found) return found.customer;
    }
    if (/^\d{5,15}$/.test(q)) {
      const byTelegram = await this.prisma.customer.findUnique({ where: { telegramId: BigInt(q) }, include });
      if (byTelegram) return byTelegram;
    }
    const username = q.replace(/^@/, '');
    if (/^[A-Za-z0-9_]{3,32}$/.test(username)) {
      return this.prisma.customer.findFirst({
        where: { telegramUsername: { equals: username, mode: 'insensitive' } },
        include,
      });
    }
    return null;
  }

  private async sendCustomerCard(ctx: Context, customer: CustomerCard): Promise<void> {
    const status =
      customer.status === 'BANNED'
        ? `🚫 محظور — ${customer.banReason ?? ''}`
        : isSuspended(customer)
          ? `⏸️ موقوف لحد ${formatUntil(customer.suspendedUntil!)}`
          : '✅ نشط';
    const keyboard = new InlineKeyboard().text('✉️ رسالة', `ad:msg:${customer.id}`).row();
    if (customer.status === 'BANNED' || isSuspended(customer)) {
      keyboard.text('✅ رفع الإيقاف/الحظر', `ad:lift:${customer.id}`);
    } else {
      keyboard.text('⏸️ إيقاف 24 ساعة', `ad:sus:${customer.id}`).text('🚫 حظر نهائي', `ad:ban:${customer.id}`);
    }
    await ctx.reply(
      [
        `👤 ${customer.fullName ?? customer.firstName ?? '—'}${customer.telegramUsername ? ` (@${customer.telegramUsername})` : ''}`,
        `🆔 ${customer.telegramId.toString()}`,
        customer.contactPhone ? `📱 ${customer.contactPhone}` : '',
        `📦 الطلبات: ${customer._count.orders}`,
        customer.verifiedAt ? '⭐ عميل موثّق' : '',
        customer.wholesaleAt ? '🏪 تاجر جملة' : '',
        `الحالة: ${status}`,
      ]
        .filter(Boolean)
        .join('\n'),
      { reply_markup: keyboard },
    );
  }
}

