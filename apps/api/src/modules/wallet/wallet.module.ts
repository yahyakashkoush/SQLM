import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AdminWalletController, WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [OrdersModule],
  controllers: [WalletController, AdminWalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
