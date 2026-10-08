import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { LegacyCustomersService } from './legacy-customers.service';
import { AdminLegacyCustomersController } from './admin-legacy-customers.controller';

/** Imported by OrdersModule, so it must not import any domain module itself. */
@Module({
  controllers: [LoyaltyController, AdminLegacyCustomersController],
  providers: [LoyaltyService, LegacyCustomersService],
  exports: [LoyaltyService, LegacyCustomersService],
})
export class LoyaltyModule {}
