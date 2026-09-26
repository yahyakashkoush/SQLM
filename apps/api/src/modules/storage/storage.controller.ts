import { Controller, Get, Param, Query, Res, NotFoundException, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import * as crypto from 'node:crypto';
import { StorageService } from './storage.service';

@Controller('storage/local')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get(':key(*)')
  async serveFile(
    @Param('key') key: string,
    @Query('expires') expires: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!this.storage.isLocal) throw new NotFoundException();

    const expiresNum = Number(expires);
    if (!expiresNum || Date.now() > expiresNum) {
      throw new BadRequestException('Link expired');
    }

    const expected = crypto
      .createHmac('sha256', 'local-storage-key')
      .update(`${key}:${expires}`)
      .digest('hex')
      .slice(0, 32);
    if (token !== expected) throw new BadRequestException('Invalid token');

    const file = await this.storage.getLocalFile(key);
    if (!file) throw new NotFoundException('File not found');

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', file.buffer.length);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(file.buffer);
  }
}
