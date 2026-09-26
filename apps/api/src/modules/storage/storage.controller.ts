import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PUBLIC_PREFIX, StorageService } from './storage.service';

@Controller('storage')
@SkipThrottle()
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  /**
   * Public keys (catalog images) are served to anyone; everything else
   * (payment proofs) needs a short-lived signed link minted by an
   * authorized endpoint.
   */
  @Get(':key(*)')
  async serveFile(
    @Param('key') key: string,
    @Query('expires') expires: string | undefined,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ) {
    const isPublic = key.startsWith(PUBLIC_PREFIX);
    if (!isPublic) {
      const expiresAt = Number(expires);
      if (!expiresAt || Date.now() > expiresAt) throw new BadRequestException('Link expired');
      if (!token || !this.storage.verifySignature(key, expiresAt, token)) {
        throw new BadRequestException('Invalid token');
      }
    }

    const file = await this.storage.read(key);
    if (!file) throw new NotFoundException('File not found');

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', file.buffer.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Cache-Control',
      isPublic ? 'public, max-age=31536000, immutable' : 'private, max-age=600',
    );
    // Uploaded files are rendered as images/PDFs only, never as documents in our origin.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(file.buffer);
  }
}
