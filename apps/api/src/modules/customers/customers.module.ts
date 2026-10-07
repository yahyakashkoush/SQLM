import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { MeController } from './me.controller';

@Module({
  controllers: [MeController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
