import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { nanoid } from 'nanoid';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { matchesDeclaredType } from '../../common/utils/file-signature';
import { PUBLIC_PREFIX, StorageService } from './storage.service';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

@Controller('admin/uploads')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminUploadsController {
  constructor(private readonly storage: StorageService) {}

  /** Catalog/payment imagery: stored under the public prefix and returned as a permanent URL. */
  @Post('images')
  @Permissions('products.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension || !matchesDeclaredType(file.buffer, file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG, WEBP or GIF images are allowed');
    }

    const key = `${PUBLIC_PREFIX}images/${nanoid()}.${extension}`;
    await this.storage.upload(key, file.buffer, file.mimetype);
    return { key, url: this.storage.publicUrl(key) };
  }
}
