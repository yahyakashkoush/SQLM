import { Injectable, Logger } from '@nestjs/common';
import type { Update } from 'grammy/types';
import { RedisService } from '../redis/redis.service';

/** A normal customer taps and types well under this; a script or a stuck key does not. */
export const FLOOD_MAX_UPDATES = 25;
export const FLOOD_WINDOW_SECONDS = 60;
export const FLOOD_MUTE_SECONDS = 10 * 60;

/**
 * accept: queue it. warn: queue only the one-time "slow down" notice.
 * drop: acknowledge to Telegram and do nothing — no queue job, no DB row.
 */
export type Admission = { verdict: 'accept' } | { verdict: 'warn'; chatId: number } | { verdict: 'drop' };

const rateKey = (userId: number) => `tg:rate:${userId}`;
const muteKey = (userId: number) => `tg:mute:${userId}`;

/**
 * Runs in the webhook, before anything is queued, so a flood costs one
 * Redis round-trip per update instead of a queue job, a log row and a
 * handler run each. Fails open: a Redis hiccup must not silence the store.
 */
@Injectable()
export class BotGuardService {
  private readonly logger = new Logger(BotGuardService.name);

  constructor(private readonly redis: RedisService) {}

  async admit(update: Update): Promise<Admission> {
    const origin = originOf(update);
    // The store bot lives in private chats. Group and channel traffic is
    // not for it, and answering there is how a bot gets used for spam.
    if (origin.chatType && origin.chatType !== 'private') return { verdict: 'drop' };
    if (origin.userId === undefined) return { verdict: 'accept' };

    try {
      const client = this.redis.client;
      if (await client.exists(muteKey(origin.userId))) return { verdict: 'drop' };

      const count = await client.incr(rateKey(origin.userId));
      if (count === 1) await client.expire(rateKey(origin.userId), FLOOD_WINDOW_SECONDS);
      if (count <= FLOOD_MAX_UPDATES) return { verdict: 'accept' };

      // NX: only the update that starts the mute gets to send the notice.
      const muted = await client.set(muteKey(origin.userId), '1', 'EX', FLOOD_MUTE_SECONDS, 'NX');
      if (muted === 'OK') {
        this.logger.warn(`Muted Telegram user ${origin.userId} for ${FLOOD_MUTE_SECONDS}s (${count} updates/min)`);
        return origin.chatId !== undefined ? { verdict: 'warn', chatId: origin.chatId } : { verdict: 'drop' };
      }
      return { verdict: 'drop' };
    } catch (err) {
      this.logger.error(`Flood check failed, letting the update through: ${err instanceof Error ? err.message : err}`);
      return { verdict: 'accept' };
    }
  }

  /** Lifts a mute early (staff action, or tests). */
  async unmute(userId: number): Promise<void> {
    await this.redis.client.del(muteKey(userId), rateKey(userId));
  }
}

function originOf(update: Update): { userId?: number; chatId?: number; chatType?: string } {
  const message =
    update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (message) return { userId: message.from?.id, chatId: message.chat.id, chatType: message.chat.type };
  if (update.callback_query) {
    const chat = update.callback_query.message?.chat;
    return { userId: update.callback_query.from.id, chatId: chat?.id, chatType: chat?.type };
  }
  if (update.my_chat_member) {
    return {
      userId: update.my_chat_member.from.id,
      chatId: update.my_chat_member.chat.id,
      chatType: update.my_chat_member.chat.type,
    };
  }
  if (update.inline_query) return { userId: update.inline_query.from.id };
  return {};
}
