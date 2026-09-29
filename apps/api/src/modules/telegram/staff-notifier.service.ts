import { Injectable, Logger } from '@nestjs/common';
import type { NotificationJob } from '../notifications/notification-dispatcher.service';
import { StaffAlertRenderer } from './staff-alert.renderer';
import { StaffTelegramService } from './staff-telegram.service';
import { TelegramBotService } from './telegram-bot.service';

/**
 * Pushes staff events to every linked staff member allowed to see them.
 *
 * One recipient failing (blocked the bot, deleted their account) is
 * logged and skipped rather than thrown: throwing would make the queue
 * retry the whole job and send everyone else the same alert again.
 */
@Injectable()
export class StaffNotifier {
  private readonly logger = new Logger(StaffNotifier.name);

  constructor(
    private readonly renderer: StaffAlertRenderer,
    private readonly staffTelegram: StaffTelegramService,
    private readonly bot: TelegramBotService,
  ) {}

  async deliver(job: NotificationJob): Promise<number> {
    const alert = await this.renderer.render(job);
    if (!alert) return 0;

    const recipients = await this.staffTelegram.recipients(alert.permission);
    let sent = 0;
    for (const recipient of recipients) {
      try {
        await this.bot.sendStaffAlert(recipient.telegramId!, alert);
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `Staff alert ${job.kind} to staff ${recipient.id} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return sent;
  }
}
