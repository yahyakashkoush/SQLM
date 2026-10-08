import { Module } from '@nestjs/common';
import { WholesaleService } from './wholesale.service';
import { AdminWholesaleController, WholesaleController } from './wholesale.controller';

@Module({
  controllers: [WholesaleController, AdminWholesaleController],
  providers: [WholesaleService],
  exports: [WholesaleService],
})
export class WholesaleModule {}
