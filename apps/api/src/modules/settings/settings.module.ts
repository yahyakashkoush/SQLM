import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { StoreController } from './store.controller';

@Global()
@Module({
  controllers: [StoreController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
