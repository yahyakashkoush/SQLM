import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

/** Public, non-sensitive store details for the Mini App header and support page. */
@Controller('store')
export class StoreController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async info() {
    return {
      name: await this.settings.getString('store.name'),
      supportContact: await this.settings.getString('store.supportContact'),
      /** For showing an EGP estimate next to USD prices; orders carry
       *  their own frozen rate, so this is display-only. */
      egpPerUsd: await this.settings.getNumber('pricing.egpPerUsd'),
    };
  }
}
