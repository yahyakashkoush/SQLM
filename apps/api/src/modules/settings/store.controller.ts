import { Controller, Get } from '@nestjs/common';
import { renderTemplate } from '@sqlm/shared';
import { SettingsService } from './settings.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';

/** Public, non-sensitive store details for the Mini App header, checkout and support page. */
@Controller('store')
export class StoreController {
  constructor(
    private readonly settings: SettingsService,
    private readonly bot: TelegramBotService,
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
      /** For t.me deep links back into the bot (the old-customer claim lives there). */
      botUsername: await this.bot.username(),
      /** For showing an EGP estimate next to USD prices; orders carry
       *  their own frozen rate, so this is display-only. */
      egpPerUsd: await this.settings.getNumber('pricing.egpPerUsd'),
    };
  }
}
