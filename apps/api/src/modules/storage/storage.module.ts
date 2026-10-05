import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { AdminUploadsController } from './admin-uploads.controller';
import { CustomerUploadsController } from './customer-uploads.controller';

@Global()
@Module({
  controllers: [StorageController, AdminUploadsController, CustomerUploadsController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
