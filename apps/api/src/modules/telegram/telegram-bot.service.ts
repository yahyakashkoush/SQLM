import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Update } from 'grammy/types';
import { ORDER_STATUS_LABELS_AR, renderTemplate, type OrderStatus } from '@sqlm/shared';
import { CustomersService } from '../customers/customers.service';
import { OrdersService } from '../orders/orders.service';
import { SupportService } from '../support/support.service';
import { PaymentProofsService } from '../payments/payment-proofs.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  MENU_ACTION_BY_LABEL,
  buildMainMenuKeyboard,
  buildWebAppButton,
  type MainMenuAction,
} from './keyboards/main-menu.keyboard';
import { withTimeout } from '../../common/utils/with-timeout';

const INIT_TIMEOUT_MS = 8000;
const INIT_RETRY_INTERVAL_MS = 30_000;
const CAPTION_LIMIT = 1024;
const PROOF_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export interface OutboundMessageOptions {
  imageUrl?: string;
  button?: { text: string; url: string };
}

export const BOT_COMMANDS = [
  { command: 'start', description: 'القائمة الرئيسية' },
  { command: 'orders', description: 'طلباتي' },
  { command: 'account', description: 'حسابي' },
  { command: 'support', description: 'الدعم الفني' },
];

/**
 * Thin bot adapter: every handler replies with a short summary built from
 * application services, or hands off to the Mini App via a `web_app` button.
 *
 * Degrades gracefully when Telegram is unreachable or `TELEGRAM_BOT_TOKEN`
 * is unset: the webhook still accepts and queues updates, outbound replies
 * are skipped with a warning, and the REST API keeps working.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly bot: Bot;
  private readonly miniAppUrl: string;
  private ready = false;
  private lastInitAttempt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly customers: CustomersService,
    private readonly orders: OrdersService,
    private readonly support: SupportService,
    private readonly paymentProofs: PaymentProofsService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN') || 'unset:unset';
    this.bot = new Bot(token);
    this.miniAppUrl = (this.config.get<string>('MINIAPP_URL') || 'http://localhost:3200').replace(/\/$/, '');
    this.registerHandlers();
  }

  get isConfigured(): boolean {
    return Boolean(this.config.get<string>('TELEGRAM_BOT_TOKEN'));
  }

  async onModuleInit(): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN not set — bot running in degraded mode (webhook accepts updates, outbound replies are skipped)',
      );
      return;
    }
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn('NODE_ENV=test — skipping Telegram bot network initialization');
      return;
    }
    try {
      await this.init();
      await this.registerWebhook();
    } catch (err) {
      this.logger.error(
        'Failed to initialize Telegram bot (continuing without it — REST API is unaffected)',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async init(): Promise<void> {
    this.lastInitAttempt = Date.now();
    // grammy's HTTP client has no call timeout; an unreachable Telegram would
    // otherwise hang the whole app's bootstrap.
    await withTimeout(this.bot.init(), INIT_TIMEOUT_MS, 'bot.init()');
    this.ready = true;
    this.logger.log(`Telegram bot initialized: @${this.bot.botInfo.username}`);
  }

  /** Lazily retries init — a boot-time network blip shouldn't disable the bot until the next deploy. */
  private async ensureReady(): Promise<boolean> {
    if (this.ready) return true;
    if (!this.isConfigured || this.config.get<string>('NODE_ENV') === 'test') return false;
    // Don't stall every queued message on an 8s timeout while Telegram is down.
    if (Date.now() - this.lastInitAttempt < INIT_RETRY_INTERVAL_MS) return false;
    this.lastInitAttempt = Date.now();
    try {
      await this.init();
      return true;
    } catch (err) {
      this.logger.warn(`Telegram bot still unreachable: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /** Registers the webhook, the command list and the Mini App menu button with Telegram. */
  async registerWebhook(): Promise<{ url: string }> {
    const url = this.config.get<string>('TELEGRAM_WEBHOOK_URL');
    const secret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (!url || !secret) {
      this.logger.warn('TELEGRAM_WEBHOOK_URL/TELEGRAM_WEBHOOK_SECRET not set — skipping webhook registration');
      return { url: '' };
    }
    await withTimeout(this.bot.api.setWebhook(url, { secret_token: secret }), INIT_TIMEOUT_MS, 'setWebhook()');
    this.logger.log(`Telegram webhook registered: ${url}`);
    await this.applyMenu().catch((err) =>
      this.logger.warn(`Could not set bot commands/menu button: ${err instanceof Error ? err.message : err}`),
    );
    return { url };
  }

  private async applyMenu(): Promise<void> {
    await this.bot.api.setMyCommands(BOT_COMMANDS);
    if (this.miniAppUrl.startsWith('https://')) {
      await this.bot.api.setChatMenuButton({
        menu_button: { type: 'web_app', text: '🛍️ المتجر', web_app: { url: this.miniAppUrl } },
      });
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async handleUpdate(update: Update): Promise<void> {
    if (!(await this.ensureReady())) {
      this.logger.warn(`Skipping update ${update.update_id} — bot not initialized`);
      return;
    }
    await this.bot.handleUpdate(update);
  }

  /**
   * Outbound push (order updates, deliveries, broadcasts). Throws on failure
   * so the calling queue job retries; a bot that can't initialize is a
   * no-op instead, since retrying that can't help.
   */
  async sendMessage(telegramId: bigint, text: string, options: OutboundMessageOptions = {}): Promise<void> {
    if (!(await this.ensureReady())) {
      this.logger.warn(`Skipping outbound message to ${telegramId} — bot not initialized`);
      return;
    }
    const chatId = Number(telegramId);
    const reply_markup = options.button ? this.buttonMarkup(options.button) : undefined;

    if (options.imageUrl && /^https:\/\//.test(options.imageUrl)) {
      try {
        if (text.length <= CAPTION_LIMIT) {
          await this.bot.api.sendPhoto(chatId, options.imageUrl, { caption: text, reply_markup });
          return;
        }
        await this.bot.api.sendPhoto(chatId, options.imageUrl);
      } catch (err) {
        // A bad image URL shouldn't cost the customer the message itself.
        this.logger.warn(`sendPhoto failed, falling back to text: ${err instanceof Error ? err.message : err}`);
      }
    }
    await this.bot.api.sendMessage(chatId, text, { reply_markup });
  }

  private buttonMarkup(button: { text: string; url: string }): InlineKeyboard {
    // web_app buttons only work for https Mini App URLs; anything else is a plain link.
    return button.url.startsWith(this.miniAppUrl) && this.miniAppUrl.startsWith('https://')
      ? new InlineKeyboard().webApp(button.text, button.url)
      : new InlineKeyboard().url(button.text, button.url);
  }

  // ---------------------------------------------------------------------------
  // Admin: status + profile
  // ---------------------------------------------------------------------------

  async getStatus() {
    const base = {
      configured: this.isConfigured,
      ready: false,
      username: null as string | null,
      name: null as string | null,
      miniAppUrl: this.miniAppUrl,
      webhookUrlConfigured: Boolean(this.config.get<string>('TELEGRAM_WEBHOOK_URL')),
      webhook: null as null | {
        url: string;
        pendingUpdateCount: number;
        lastErrorMessage: string | null;
        lastErrorDate: string | null;
      },
      description: '',
      shortDescription: '',
      error: null as string | null,
    };
    if (!(await this.ensureReady())) {
      return { ...base, error: this.isConfigured ? 'Could not reach Telegram' : 'TELEGRAM_BOT_TOKEN is not set' };
    }
    try {
      const [info, description, shortDescription] = await Promise.all([
        withTimeout(this.bot.api.getWebhookInfo(), INIT_TIMEOUT_MS, 'getWebhookInfo()'),
        this.bot.api.getMyDescription(),
        this.bot.api.getMyShortDescription(),
      ]);
      return {
        ...base,
        ready: true,
        username: this.bot.botInfo.username,
        name: this.bot.botInfo.first_name,
        webhook: {
          url: info.url,
          pendingUpdateCount: info.pending_update_count,
          lastErrorMessage: info.last_error_message ?? null,
          lastErrorDate: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
        },
        description: description.description,
        shortDescription: shortDescription.short_description,
      };
    } catch (err) {
      return { ...base, ready: true, username: this.bot.botInfo.username, error: String(err) };
    }
  }

  async updateProfile(profile: { name?: string; description?: string; shortDescription?: string }) {
    if (!(await this.ensureReady())) throw new ServiceUnavailableException('Telegram bot is not connected');
    if (profile.name !== undefined) await this.bot.api.setMyName(profile.name);
    if (profile.description !== undefined) await this.bot.api.setMyDescription(profile.description);
    if (profile.shortDescription !== undefined) {
      await this.bot.api.setMyShortDescription(profile.shortDescription);
    }
    return this.getStatus();
  }

  async reconnect() {
    if (!this.isConfigured) throw new ServiceUnavailableException('TELEGRAM_BOT_TOKEN is not set');
    if (!(await this.ensureReady())) throw new ServiceUnavailableException('Could not reach Telegram');
    await this.registerWebhook();
    return this.getStatus();
  }

  // ---------------------------------------------------------------------------
  // Update handlers
  // ---------------------------------------------------------------------------

  private registerHandlers(): void {
    this.bot.command('start', async (ctx) => {
      const customer = await this.upsertCustomer(ctx);
      const text = renderTemplate(await this.settings.getString('bot.welcomeMessage'), {
        ...(await this.settings.storeValues()),
        customer_name: customer?.firstName ?? '',
      });
      await ctx.reply(text, { reply_markup: buildMainMenuKeyboard() });
      await ctx.reply('اضغط للدخول للمتجر 👇', {
        reply_markup: buildWebAppButton('🛍️ افتح المتجر', this.miniAppUrl),
      });
    });

    this.bot.command('orders', async (ctx) => this.replyWithOrders(ctx));
    this.bot.command('account', async (ctx) => this.replyWithAccount(ctx));
    this.bot.command('support', async (ctx) => this.handleMenu(ctx, 'SUPPORT'));

    this.bot.on(['message:photo', 'message:document'], async (ctx) => this.handleProofUpload(ctx));

    // Anything else the customer types is a support message, so the bot
    // doubles as the support channel the Admin Dashboard answers in.
    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text.trim();
      if (!text || text.startsWith('/')) return;

      const action = MENU_ACTION_BY_LABEL[text];
      if (action) {
        await this.handleMenu(ctx, action);
        return;
      }

      const customer = await this.upsertCustomer(ctx);
      if (!customer) return;
      const ticket = await this.support.findOrCreateActiveTicket(customer.id, 'محادثة تيليجرام', text);
      await ctx.reply(`🎫 تم إضافة رسالتك لتذكرة الدعم #${ticket.ticketNumber}. فريق الدعم هيرد عليك هنا.`);
    });

    this.bot.catch((err) => {
      this.logger.error(`Unhandled error processing update ${err.ctx.update.update_id}`, err.error);
    });
  }

  private async handleMenu(ctx: Context, action: MainMenuAction): Promise<void> {
    const values = await this.settings.storeValues();
    switch (action) {
      case 'HOME':
        await ctx.reply(`🏠 ${values.store_name}`, {
          reply_markup: buildWebAppButton('🛍️ افتح المتجر', this.miniAppUrl),
        });
        return;
      case 'PRODUCTS':
        await ctx.reply('🛍️ تصفح كل المنتجات', {
          reply_markup: buildWebAppButton('عرض المنتجات', `${this.miniAppUrl}/shop`),
        });
        return;
      case 'OFFERS':
        await ctx.reply('🔥 أقوى العروض المتاحة دلوقتي', {
          reply_markup: buildWebAppButton('عرض العروض', `${this.miniAppUrl}/shop?featured=true`),
        });
        return;
      case 'SEARCH':
        await ctx.reply('🔎 ابحث عن المنتج اللي محتاجه', {
          reply_markup: buildWebAppButton('بحث', `${this.miniAppUrl}/shop`),
        });
        return;
      case 'ORDERS':
        await this.replyWithOrders(ctx);
        return;
      case 'PAYMENT':
        await ctx.reply(renderTemplate(await this.settings.getString('bot.paymentMessage'), values), {
          reply_markup: buildWebAppButton('طلباتي', `${this.miniAppUrl}/orders`),
        });
        return;
      case 'SUPPORT':
        await ctx.reply(renderTemplate(await this.settings.getString('bot.supportMessage'), values), {
          reply_markup: buildWebAppButton('تذاكر الدعم', `${this.miniAppUrl}/support`),
        });
        return;
      case 'ACCOUNT':
        await this.replyWithAccount(ctx);
        return;
    }
  }

  /** A payment screenshot sent straight into the chat is attached to the customer's awaiting-payment order. */
  private async handleProofUpload(ctx: Context): Promise<void> {
    const customer = await this.upsertCustomer(ctx);
    if (!customer || !ctx.message) return;

    const order = await this.prisma.order.findFirst({
      where: { customerId: customer.id, status: 'PENDING_PAYMENT' },
      orderBy: { createdAt: 'desc' },
    });
    if (!order) {
      await ctx.reply('📎 مفيش طلب في انتظار الدفع حالياً. لو محتاج مساعدة اكتب رسالتك هنا وهنرد عليك.');
      return;
    }

    const photo = ctx.message.photo?.at(-1);
    const document = ctx.message.document;
    const fileId = photo?.file_id ?? document?.file_id;
    const mimeType = photo ? 'image/jpeg' : (document?.mime_type ?? '');
    if (!fileId || !PROOF_MIME_TYPES.has(mimeType)) {
      await ctx.reply('⚠️ ابعت صورة الإيصال (JPG/PNG) أو ملف PDF.');
      return;
    }

    try {
      const file = await ctx.api.getFile(fileId);
      const token = this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const extension = file.file_path?.split('.').pop() ?? (mimeType === 'application/pdf' ? 'pdf' : 'jpg');

      await this.paymentProofs.uploadProof(order.id, customer.id, {
        buffer,
        mimetype: mimeType,
        size: buffer.length,
        originalname: `telegram.${extension}`,
      });
      await ctx.reply(
        `✅ تم استلام إثبات الدفع لطلب #${order.sequenceNumber}.\nجاري المراجعة وهنبلغك أول ما يتأكد.`,
        { reply_markup: buildWebAppButton('متابعة الطلب', `${this.miniAppUrl}/orders/${order.id}`) },
      );
    } catch (err) {
      this.logger.warn(`Telegram proof upload failed for order ${order.id}: ${err instanceof Error ? err.message : err}`);
      await ctx.reply('⚠️ حصلت مشكلة في رفع الإيصال. جرّب تاني أو ارفعه من صفحة الطلب في التطبيق.', {
        reply_markup: buildWebAppButton('صفحة الطلب', `${this.miniAppUrl}/orders/${order.id}`),
      });
    }
  }

  private async upsertCustomer(ctx: Context) {
    if (!ctx.from) return null;
    return this.customers.upsertFromTelegram({
      id: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      languageCode: ctx.from.language_code,
    });
  }

  private async replyWithOrders(ctx: Context) {
    const customer = await this.upsertCustomer(ctx);
    if (!customer) return;

    const { items, total } = await this.orders.listForCustomer(customer.id, { page: 1, pageSize: 5 });
    if (items.length === 0) {
      await ctx.reply('📦 لسه معندكش طلبات.', {
        reply_markup: buildWebAppButton('تصفح المنتجات', `${this.miniAppUrl}/shop`),
      });
      return;
    }

    const lines = items.map(
      (order) =>
        `#${order.sequenceNumber} — ${ORDER_STATUS_LABELS_AR[order.status as OrderStatus] ?? order.status} — ${order.total} ${order.currency}`,
    );
    await ctx.reply(`📦 آخر طلباتك (${total} إجمالي):\n\n${lines.join('\n')}`, {
      reply_markup: buildWebAppButton('كل الطلبات', `${this.miniAppUrl}/orders`),
    });
  }

  private async replyWithAccount(ctx: Context) {
    const customer = await this.upsertCustomer(ctx);
    if (!customer) return;

    await ctx.reply(
      `👤 حسابي\n\nالاسم: ${customer.firstName ?? '—'}\nاليوزر: ${customer.telegramUsername ? '@' + customer.telegramUsername : '—'}\nعضو منذ: ${customer.createdAt.toLocaleDateString('ar-EG')}`,
      { reply_markup: buildWebAppButton('إدارة الحساب', `${this.miniAppUrl}/account`) },
    );
  }
}
