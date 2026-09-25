import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Update } from 'grammy/types';
import { RedisService } from '../redis/redis.service';
import { QUEUE_NAMES } from '../queue/queue-names';

const UPDATE_ID_CLAIM_TTL_SECONDS = 24 * 60 * 60;

/**
 * Webhook handling must be fast (spec §14): validate, derive an idempotency
 * key, enqueue, return. No business logic, no Prisma, no calls to Telegram
 * — that all happens in the worker (`TelegramUpdateProcessor`) consuming
 * the `telegram-updates` queue.
 */
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.TELEGRAM_UPDATES) private readonly queue: Queue,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Post('webhook/:secret')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('secret') secret: string,
    @Headers('x-telegram-bot-api-secret-token') headerSecret: string | undefined,
    @Body() update: Update,
  ): Promise<{ ok: true }> {
    const expectedSecret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (!expectedSecret || secret !== expectedSecret || headerSecret !== expectedSecret) {
      throw new ForbiddenException('Invalid webhook secret');
    }

    if (typeof update?.update_id !== 'number') {
      throw new BadRequestException('Missing update_id');
    }

    // First line of defense against Telegram's at-least-once delivery:
    // duplicate deliveries never even reach the queue.
    const claimed = await this.redis.claimOnce(
      `telegram:update:${update.update_id}`,
      UPDATE_ID_CLAIM_TTL_SECONDS,
    );
    if (!claimed) {
      this.logger.debug(`Duplicate Telegram update ${update.update_id} — already queued`);
      return { ok: true };
    }

    await this.queue.add('process-update', update, {
      jobId: `telegram-update-${update.update_id}`,
    });

    return { ok: true };
  }
}
