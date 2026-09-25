import { Module } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { PermissionsGuard } from './guards/permissions.guard';

@Module({
  controllers: [RbacController],
  providers: [PermissionsGuard],
  exports: [PermissionsGuard],
})
export class RbacModule {}
