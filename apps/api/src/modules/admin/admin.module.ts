import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { ProfitReportService } from './profit-report.service';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [LoyaltyModule, OrdersModule],
  controllers: [AdminController],
  providers: [AdminService, ProfitReportService],
})
export class AdminModule {}
