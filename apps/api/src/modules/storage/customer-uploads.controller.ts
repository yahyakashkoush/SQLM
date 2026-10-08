import {
  BadRequestException,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { nanoid } from 'nanoid';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import { CurrentCustomer, type AuthenticatedCustomer } from '../rbac/decorators/current-customer.decorator';
import { RedisService } from '../redis/redis.service';
import { matchesDeclaredType } from '../../common/utils/file-signature';
import { PUBLIC_PREFIX, StorageService } from './storage.service';

const MAX_BYTES = 5 * 1024 * 1024;
/** Plenty for a few reward claims; a script filling the disk hits it fast. */
const MAX_UPLOADS_PER_HOUR = 20;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Controller('storage')
export class CustomerUploadsController {
  constructor(
    private readonly storage: StorageService,
    private readonly redis: RedisService,
  ) {}

  /** Customer-facing upload for social reward proof screenshots. */
  @Post('upload')
  @UseGuards(JwtCustomerAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadScreenshot(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const key = `uploads:customer:${customer.id}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, 3600);
    if (count > MAX_UPLOADS_PER_HOUR) {
      throw new HttpException('رفعت صور كتير — استنى شوية وجرّب تاني.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension || !matchesDeclaredType(file.buffer, file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG or WEBP images are allowed');
    }

    const objectKey = `${PUBLIC_PREFIX}screenshots/${nanoid()}.${extension}`;
    await this.storage.upload(objectKey, file.buffer, file.mimetype);
    return { url: this.storage.publicUrl(objectKey) };
  }
}
