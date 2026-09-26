import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Update } from 'grammy/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramBotService } from './telegram-bot.service';
import { QUEUE_NAMES } from '../queue/queue-names';

const UPDATE_LOG_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Consumes the `telegram-updates` queue. Second line of defense against
 * duplicate processing (behind the webhook's Redis claim): a unique
 * constraint on `TelegramUpdateLog.updateId` catches the case where a job
 * was enqueued twice despite the Redis check — e.g. Redis was briefly
 * unavailable when the first webhook call landed.
 */
@Processor(QUEUE_NAMES.TELEGRAM_UPDATES)
export class TelegramUpdateProcessor extends WorkerHost {
  private readonly logger = new Logger(TelegramUpdateProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotService,
  ) {
    super();
  }

  async process(job: Job<Update>): Promise<void> {
    const update = job.data;
    const updateId = BigInt(update.update_id);

    try {
      await this.prisma.telegramUpdateLog.create({
        data: { updateId, status: 'PROCESSING' },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === UPDATE_LOG_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        this.logger.debug(`Update ${update.update_id} already processed — skipping`);
        return;
      }
      throw err;
    }

    try {
      await this.bot.handleUpdate(update);
      await this.prisma.telegramUpdateLog.update({
        where: { updateId },
        data: { status: 'COMPLETED', processedAt: new Date() },
      });
    } catch (err) {
      await this.prisma.telegramUpdateLog.update({
        where: { updateId },
        data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err) },
      });
      throw err; // let BullMQ retry per the queue's defaultJobOptions
    }
  }
}
