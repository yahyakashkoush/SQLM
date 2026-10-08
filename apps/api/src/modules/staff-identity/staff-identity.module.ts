import { Global, Module } from '@nestjs/common';
import { StaffIdentityService } from './staff-identity.service';

/** Global: the bot, auth and the customer profile all ask the same question. */
@Global()
@Module({
  providers: [StaffIdentityService],
  exports: [StaffIdentityService],
})
export class StaffIdentityModule {}
