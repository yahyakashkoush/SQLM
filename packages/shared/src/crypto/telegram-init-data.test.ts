import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTelegramInitData, TelegramInitDataError } from './telegram-init-data';

const BOT_TOKEN = '123456:test-bot-token';

/** Mirrors what Telegram itself does when it signs initData — test-only. */
function buildSignedInitData(
  fields: Record<string, string>,
  botToken: string = BOT_TOKEN,
): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

function freshFields(overrides: Record<string, string> = {}) {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 42, username: 'yahya', first_name: 'Yahya', language_code: 'en' }),
    query_id: 'AAEAAAAA',
    ...overrides,
  };
}

test('accepts a correctly signed, fresh initData payload', () => {
  const initData = buildSignedInitData(freshFields());
  const result = verifyTelegramInitData(initData, BOT_TOKEN);
  assert.equal(result.user.id, 42);
  assert.equal(result.user.username, 'yahya');
});

test('rejects a payload signed with the wrong bot token', () => {
  const initData = buildSignedInitData(freshFields(), 'wrong-token');
  assert.throws(() => verifyTelegramInitData(initData, BOT_TOKEN), TelegramInitDataError);
});

test('rejects a tampered field (user id swapped after signing)', () => {
  const initData = buildSignedInitData(freshFields());
  const tampered = initData.replace('%22id%22%3A42', '%22id%22%3A99');
  assert.throws(() => verifyTelegramInitData(tampered, BOT_TOKEN), TelegramInitDataError);
});

test('rejects stale initData beyond maxAgeSeconds', () => {
  const oldTimestamp = Math.floor(Date.now() / 1000) - 100_000;
  const initData = buildSignedInitData(freshFields({ auth_date: String(oldTimestamp) }));
  assert.throws(
    () => verifyTelegramInitData(initData, BOT_TOKEN, 86_400),
    TelegramInitDataError,
  );
});

test('rejects a payload with no hash', () => {
  const params = new URLSearchParams(freshFields());
  assert.throws(() => verifyTelegramInitData(params.toString(), BOT_TOKEN), TelegramInitDataError);
});
