import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, type Context } from 'grammy';
import type { Update } from 'grammy/types';
import { CustomersService } from '../customers/customers.service';
import { OrdersService } from '../orders/orders.service';
import { MAIN_MENU_LABELS, buildMainMenuKeyboard, buildWebAppButton } from './keyboards/main-menu.keyboard';
import { withTimeout } from '../../common/utils/with-timeout';

const INIT_TIMEOUT_MS = 8000;

/**
 * Thin bot adapter (ARCHITECTURE.md §5): every handler either replies with
 * a short text summary built from application services, or hands off to
 * the Mini App via a `web_app` button — it never touches Prisma directly.
 *
 * Degrades gracefully when Telegram is unreachable or `TELEGRAM_BOT_TOKEN`
 * is unset (common in dev/CI): the webhook still accepts and queues
 * updates, but outbound replies are skipped with a warning instead of
 * crashing the process. The core REST API must keep working even if the
 * bot adapter can't reach Telegram.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly bot: Bot;
  private readonly miniAppUrl: string;
  private ready = false;

  constructor(
    private readonly config: ConfigService,
    private readonly customers: CustomersService,
    private readonly orders: OrdersService,
  ) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN') || 'unset:unset';
    this.bot = new Bot(token);
    this.miniAppUrl = this.config.get<string>('MINIAPP_URL', 'http://localhost:3200');
    this.registerHandlers();
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.get<string>('TELEGRAM_BOT_TOKEN')) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN not set — bot running in degraded mode (webhook accepts updates, outbound replies are skipped)',
      );
      return;
    }
    // The test suite boots AppModule repeatedly and has no real Telegram
    // credentials — skip the network round-trip entirely rather than pay a
    // bounded timeout on every single test file.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn('NODE_ENV=test — skipping Telegram bot network initialization');
      return;
    }
    try {
      // grammy's HTTP client has no built-in call timeout, so an
      // unreachable Telegram (network policy, outage) would otherwise hang
      // this indefinitely — and since this runs inside onModuleInit, that
      // hangs the entire app's bootstrap, including the plain REST API
      // that has nothing to do with the bot. Bound it explicitly.
      await withTimeout(this.bot.init(), INIT_TIMEOUT_MS, 'bot.init()');
      this.ready = true;
      this.logger.log(`Telegram bot initialized: @${this.bot.botInfo.username}`);
      await this.registerWebhook();
    } catch (err) {
      this.logger.error(
        'Failed to initialize Telegram bot (continuing without it — REST API is unaffected)',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Self-registers the webhook URL with Telegram on boot — spec §14: "Use Telegram Webhooks in production." */
  private async registerWebhook(): Promise<void> {
    const url = this.config.get<string>('TELEGRAM_WEBHOOK_URL');
    const secret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (!url || !secret) {
      this.logger.warn('TELEGRAM_WEBHOOK_URL/TELEGRAM_WEBHOOK_SECRET not set — skipping webhook registration');
      return;
    }
    await withTimeout(
      this.bot.api.setWebhook(url, { secret_token: secret }),
      INIT_TIMEOUT_MS,
      'setWebhook()',
    );
    this.logger.log(`Telegram webhook registered: ${url}`);
  }

  isReady(): boolean {
    return this.ready;
  }

  async handleUpdate(update: Update): Promise<void> {
    if (!this.ready) {
      this.logger.warn(`Skipping update ${update.update_id} — bot not initialized`);
      return;
    }
    await this.bot.handleUpdate(update);
  }

  private registerHandlers(): void {
    this.bot.command('start', async (ctx) => {
      await this.upsertCustomer(ctx);
      await ctx.reply(
        "Welcome to SQLM Store! Browse digital products, track orders, and get support — all from the menu below.",
        { reply_markup: buildMainMenuKeyboard() },
      );
    });

    this.bot.hears(MAIN_MENU_LABELS.HOME, async (ctx) => {
      await ctx.reply('🏠 Home', { reply_markup: buildWebAppButton('Open Store', this.miniAppUrl) });
    });

    this.bot.hears(MAIN_MENU_LABELS.PRODUCTS, async (ctx) => {
      await ctx.reply('🛍️ Browse our products', {
        reply_markup: buildWebAppButton('Browse Products', `${this.miniAppUrl}/shop`),
      });
    });

    this.bot.hears(MAIN_MENU_LABELS.OFFERS, async (ctx) => {
      await ctx.reply('🔥 Check out our featured offers', {
        reply_markup: buildWebAppButton('View Offers', `${this.miniAppUrl}/shop?featured=true`),
      });
    });

    this.bot.hears(MAIN_MENU_LABELS.SEARCH, async (ctx) => {
      await ctx.reply('🔎 Search the catalog', {
        reply_markup: buildWebAppButton('Search', `${this.miniAppUrl}/shop`),
      });
    });

    this.bot.hears(MAIN_MENU_LABELS.ORDERS, async (ctx) => this.replyWithOrders(ctx));
    this.bot.command('orders', async (ctx) => this.replyWithOrders(ctx));

    this.bot.hears(MAIN_MENU_LABELS.PAYMENT, async (ctx) => {
      await ctx.reply('💳 Payment instructions are shown per-order once you check out.', {
        reply_markup: buildWebAppButton('My Orders', `${this.miniAppUrl}/orders`),
      });
    });

    this.bot.hears(MAIN_MENU_LABELS.SUPPORT, async (ctx) => {
      await ctx.reply('🎫 Need help? Open a support ticket and our team will reply here.', {
        reply_markup: buildWebAppButton('Open Support', `${this.miniAppUrl}/support`),
      });
    });

    this.bot.hears(MAIN_MENU_LABELS.ACCOUNT, async (ctx) => this.replyWithAccount(ctx));
    this.bot.command('account', async (ctx) => this.replyWithAccount(ctx));

    this.bot.catch((err) => {
      this.logger.error(`Unhandled error processing update ${err.ctx.update.update_id}`, err.error);
    });
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
      await ctx.reply("📦 You don't have any orders yet.", {
        reply_markup: buildWebAppButton('Browse Products', `${this.miniAppUrl}/shop`),
      });
      return;
    }

    const lines = items.map(
      (order) => `#${order.sequenceNumber} — ${order.status} — ${order.total} ${order.currency}`,
    );
    await ctx.reply(`📦 Your recent orders (${total} total):\n\n${lines.join('\n')}`, {
      reply_markup: buildWebAppButton('View All Orders', `${this.miniAppUrl}/orders`),
    });
  }

  private async replyWithAccount(ctx: Context) {
    const customer = await this.upsertCustomer(ctx);
    if (!customer) return;

    await ctx.reply(
      `👤 Account\n\nName: ${customer.firstName ?? 'N/A'}\nUsername: ${customer.telegramUsername ? '@' + customer.telegramUsername : 'N/A'}\nMember since: ${customer.createdAt.toDateString()}`,
      { reply_markup: buildWebAppButton('Manage Account', `${this.miniAppUrl}/account`) },
    );
  }
}
