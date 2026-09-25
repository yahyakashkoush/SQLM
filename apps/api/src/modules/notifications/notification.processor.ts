import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';
import { QUEUE_NAMES } from '../queue/queue-names';
import type { NotificationJob } from './notification-dispatcher.service';

/**
 * Durable leg of notification delivery: pushes customer-facing events to
 * Telegram. Staff-audience events are realtime-only (the dashboard is the
 * staff channel), so they complete immediately here rather than fanning out
 * to every staff member's chat.
 *
 * Retries and backoff come from the queue's default job options; a failure
 * re-throws so BullMQ can retry rather than silently dropping the message.
 */
@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotService,
  ) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<void> {
    const data = job.data;
    if (data.audience !== 'CUSTOMER' || !data.customerId) return;

    const customer = await this.prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { telegramId: true },
    });
    if (!customer) {
      this.logger.warn(`Notification ${data.kind}: customer ${data.customerId} no longer exists`);
      return;
    }

    const text = data.body ? `${data.summary}\n\n${data.body}` : data.summary;
    await this.bot.sendMessage(customer.telegramId, text);
  }
}
