import { Module } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { AdminCouponsController } from './coupons.controller';

/**
 * Deliberately free of other domain modules. OrdersModule imports this one
 * to price a checkout, so anything imported here would close a cycle — the
 * customer-facing quote endpoint lives in OrdersModule for that reason,
 * next to the cart pricing it needs.
 */
@Module({
  controllers: [AdminCouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
