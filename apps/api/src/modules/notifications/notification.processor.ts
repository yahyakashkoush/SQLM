import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';
import { QUEUE_NAMES } from '../queue/queue-names';
import type { NotificationJob } from './notification-dispatcher.service';
import { DeliveryMessageRenderer } from './delivery-message.renderer';

/**
 * Durable leg of notification delivery: pushes customer-facing events to
 * Telegram. Staff-audience events are realtime-only (the dashboard is the
 * staff channel), so they complete immediately here rather than fanning out
 * to every staff member's chat.
 *
 * Rate-limited below Telegram's ~30 msg/s bot ceiling so a broadcast to the
 * whole customer base drains steadily instead of tripping 429s. Failures
 * re-throw so BullMQ retries with the queue's backoff.
 */
@Processor(QUEUE_NAMES.NOTIFICATIONS, { limiter: { max: 25, duration: 1000 } })
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotService,
    private readonly deliveryMessages: DeliveryMessageRenderer,
  ) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<void> {
    const data = job.data;
    if (data.audience !== 'CUSTOMER' || !data.customerId || data.silent) return;

    const customer = await this.prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { telegramId: true, status: true },
    });
    if (!customer) {
      this.logger.warn(`Notification ${data.kind}: customer ${data.customerId} no longer exists`);
      return;
    }
    if (customer.status !== 'ACTIVE' && data.kind === 'broadcast') return;

    let text = data.body ? `${data.summary}\n\n${data.body}` : data.summary;
    if (data.deliveryId) {
      text = (await this.deliveryMessages.render(data.deliveryId)) ?? text;
    }

    try {
      await this.bot.sendMessage(customer.telegramId, text, {
        imageUrl: data.imageUrl,
        button: data.button,
      });
    } catch (err) {
      // A customer who blocked the bot will never accept a message; retrying just burns quota.
      if (isPermanentTelegramError(err)) {
        this.logger.warn(`Notification ${data.kind} to ${data.customerId} dropped: ${String(err)}`);
        return;
      }
      throw err;
    }
  }
}

function isPermanentTelegramError(err: unknown): boolean {
  const code = (err as { error_code?: number })?.error_code;
  return code === 403 || code === 400;
}
