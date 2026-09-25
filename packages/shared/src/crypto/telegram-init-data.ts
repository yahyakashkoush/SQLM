import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validates Telegram Mini App `initData` per Telegram's documented
 * algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret_key = HMAC_SHA256(bot_token, key="WebAppData")
 *   check_hash = HMAC_SHA256(data_check_string, key=secret_key)
 *
 * where `data_check_string` is every field except `hash`, sorted
 * alphabetically, joined as `key=value` with `\n`. This is the only way to
 * authenticate a Mini App session server-side — never trust a client-sent
 * user id without this check, since `initData` is otherwise forgeable.
 */

export interface TelegramInitDataUser {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

export interface TelegramInitDataResult {
  user: TelegramInitDataUser;
  authDate: number;
}

export class TelegramInitDataError extends Error {}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
): TelegramInitDataResult {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new TelegramInitDataError('missing hash');
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const computedBuf = Buffer.from(computedHash, 'hex');
  const providedBuf = Buffer.from(hash, 'hex');
  if (
    computedBuf.length !== providedBuf.length ||
    !timingSafeEqual(computedBuf, providedBuf)
  ) {
    throw new TelegramInitDataError('hash mismatch');
  }

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) {
    throw new TelegramInitDataError('missing auth_date');
  }
  const authDate = Number(authDateRaw);
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > maxAgeSeconds || ageSeconds < -60) {
    throw new TelegramInitDataError('stale or future-dated initData');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new TelegramInitDataError('missing user');
  }
  let parsedUser: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    language_code?: string;
  };
  try {
    parsedUser = JSON.parse(userRaw);
  } catch {
    throw new TelegramInitDataError('malformed user field');
  }

  return {
    authDate,
    user: {
      id: parsedUser.id,
      username: parsedUser.username,
      firstName: parsedUser.first_name,
      lastName: parsedUser.last_name,
      languageCode: parsedUser.language_code,
    },
  };
}
