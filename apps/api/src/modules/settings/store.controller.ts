import { Controller, Get, Header } from '@nestjs/common';
import { renderTemplate } from '@sqlm/shared';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';

/** Public, non-sensitive store details for the Mini App header, checkout and support page. */
@Controller('store')
export class StoreController {
  constructor(
    private readonly settings: SettingsService,
    private readonly bot: TelegramBotService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async info() {
    const values = await this.settings.storeValues();
    return {
      name: values.store_name,
      supportContact: values.support_contact,
      deliveryTime: values.delivery_time,
      /** Shown on the payment step: what happens to a fake receipt. */
      proofWarning: values.proof_warning,
      rules: renderTemplate(await this.settings.getString('store.rules'), values),
      terms: renderTemplate(await this.settings.getString('site.terms'), values),
      /** For t.me deep links back into the bot (the old-customer claim lives there). */
      botUsername: await this.bot.username(),
      /** For showing an EGP estimate next to USD prices; orders carry
       *  their own frozen rate, so this is display-only. */
      egpPerUsd: await this.settings.getNumber('pricing.egpPerUsd'),
    };
  }

  /**
   * Everything the public website shows, in one call. No prices and no
   * payment account numbers: the site is a front door to the bot, and the
   * bot is where a customer sees what to pay and where.
   */
  @Get('site')
  @Header('Cache-Control', 'public, max-age=60')
  async site() {
    const values = await this.settings.storeValues();
    const [tagline, about, botUrl, terms, methods, categories, products] = await Promise.all([
      this.settings.getString('site.tagline'),
      this.settings.getString('site.about'),
      this.settings.getString('site.botUrl'),
      this.settings.getString('site.terms'),
      this.prisma.paymentMethod.findMany({
        where: { enabled: true },
        orderBy: { displayOrder: 'asc' },
        select: { id: true, name: true, description: true, provider: true, currency: true, cryptoAsset: true },
      }),
      this.prisma.category.findMany({
        where: { status: 'ACTIVE', products: { some: { status: 'ACTIVE', visibility: 'VISIBLE' } } },
        orderBy: { displayOrder: 'asc' },
        select: { id: true, slug: true, name: true },
      }),
      this.prisma.product.findMany({
        where: { status: 'ACTIVE', visibility: 'VISIBLE', giftType: null },
        orderBy: [{ featured: 'desc' }, { salesCount: 'desc' }, { createdAt: 'desc' }],
        take: 60,
        select: {
          id: true,
          slug: true,
          name: true,
          shortDescription: true,
          images: true,
          duration: true,
          badge: true,
          featured: true,
          ratingScore: true,
          reviewCount: true,
          categoryId: true,
        },
      }),
    ]);
    return {
      name: values.store_name,
      tagline,
      about: renderTemplate(about, values),
      botUrl: /^https:\/\/t\.me\//.test(botUrl) ? botUrl : 'https://t.me/subsctech_bot',
      supportContact: values.support_contact,
      deliveryTime: values.delivery_time,
      terms: renderTemplate(terms, values),
      paymentMethods: methods.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        kind: m.provider === 'MANUAL' ? 'manual' : 'crypto',
        currency: m.provider === 'MANUAL' ? m.currency : (m.cryptoAsset ?? 'USDT'),
      })),
      categories,
      products,
    };
  }
}
