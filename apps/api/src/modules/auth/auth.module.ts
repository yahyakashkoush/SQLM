import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { StaffAuthService } from './staff-auth.service';
import { StaffAuthController } from './staff-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerAuthController } from './customer-auth.controller';
import { JwtStaffStrategy } from './strategies/jwt-staff.strategy';
import { JwtCustomerStrategy } from './strategies/jwt-customer.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [StaffAuthController, CustomerAuthController],
  providers: [StaffAuthService, CustomerAuthService, JwtStaffStrategy, JwtCustomerStrategy],
  exports: [StaffAuthService, CustomerAuthService],
})
export class AuthModule {}
