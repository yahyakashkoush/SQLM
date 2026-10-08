import { Module } from '@nestjs/common';
import { GiftsService } from './gifts.service';
import { ReviewsService } from './reviews.service';
import { GiftsController } from './gifts.controller';
import { AdminGiftsController } from './admin-gifts.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [GiftsController, AdminGiftsController],
  providers: [GiftsService, ReviewsService],
  exports: [GiftsService, ReviewsService],
})
export class GiftsModule {}
