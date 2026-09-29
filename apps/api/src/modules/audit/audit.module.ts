import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global: nearly every staff-mutation module needs to write audit entries,
 * and re-importing AuditModule everywhere it's needed would be pure
 * boilerplate for a provider with no configuration surface.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
