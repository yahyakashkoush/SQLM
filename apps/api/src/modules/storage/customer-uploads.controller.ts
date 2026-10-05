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
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import { matchesDeclaredType } from '../../common/utils/file-signature';
import { PUBLIC_PREFIX, StorageService } from './storage.service';

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Controller('storage')
export class CustomerUploadsController {
  constructor(private readonly storage: StorageService) {}

  /** Customer-facing upload for social reward proof screenshots. */
  @Post('upload')
  @UseGuards(JwtCustomerAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadScreenshot(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension || !matchesDeclaredType(file.buffer, file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG or WEBP images are allowed');
    }

    const key = `${PUBLIC_PREFIX}screenshots/${nanoid()}.${extension}`;
    await this.storage.upload(key, file.buffer, file.mimetype);
    return { url: this.storage.publicUrl(key) };
  }
}
