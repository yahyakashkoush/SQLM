import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { api, setTelegramInitData } from './api';
import { useAuthStore } from '@/store/auth-store';

/**
 * The Mini App's access token lives 24h with no refresh token, and the
 * Telegram provider only authenticates when the persisted store has no
 * token at all. A customer returning the next day therefore kept sending
 * an expired token forever: checkout answered "Invalid or expired session"
 * and no code path replaced it. These pin the recovery.
 */

const CUSTOMER = { id: 'cus_1', telegramId: '42', firstName: 'Test' };

interface Call {
  url: string;
  authorization: string | null;
}

let calls: Call[];
let originalFetch: typeof globalThis.fetch;

/**
 * Responds to /auth/telegram with a fresh token and to everything else
 * with `beforeReauth` until a re-auth happens, `afterReauth` after it.
 */
function stubFetch(options: {
  beforeReauth: number;
  afterReauth: number;
  authStatus?: number;
}): void {
  let reauthed = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, authorization: headers.get('Authorization') });

    if (url.endsWith('/auth/telegram')) {
      const status = options.authStatus ?? 200;
      if (status !== 200) {
        return new Response(JSON.stringify({ message: 'bad initData' }), { status });
      }
      reauthed = true;
      return new Response(JSON.stringify({ accessToken: 'fresh-token', customer: CUSTOMER }), {
        status: 200,
      });
    }

    const status = reauthed ? options.afterReauth : options.beforeReauth;
    return new Response(JSON.stringify(status === 200 ? { id: 'ord_1' } : { message: 'Invalid or expired session' }), {
      status,
    });
  }) as typeof globalThis.fetch;
}

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;
  useAuthStore.getState().setSession('expired-token', CUSTOMER as never);
  setTelegramInitData('user=%7B%22id%22%3A42%7D&hash=abc');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  useAuthStore.getState().clearSession();
  setTelegramInitData(null);
});

test('re-authenticates and retries when the stored token has expired', async () => {
  stubFetch({ beforeReauth: 401, afterReauth: 200 });

  const order = await api.getOrder('ord_1');

  assert.deepEqual(order, { id: 'ord_1' });
  assert.equal(useAuthStore.getState().accessToken, 'fresh-token');
  // Expired attempt, re-auth, then the retry carrying the new token.
  assert.equal(calls.length, 3);
  assert.equal(calls[0].authorization, 'Bearer expired-token');
  assert.ok(calls[1].url.endsWith('/auth/telegram'));
  assert.equal(calls[2].authorization, 'Bearer fresh-token');
});

test('gives up after one retry rather than looping on a rejected token', async () => {
  stubFetch({ beforeReauth: 401, afterReauth: 401 });

  await assert.rejects(() => api.getOrder('ord_1'), /Invalid or expired session/);
  // Original, re-auth, retry — and no second re-auth.
  assert.equal(calls.length, 3);
});

test('clears the session when initData itself is refused', async () => {
  stubFetch({ beforeReauth: 401, afterReauth: 200, authStatus: 401 });

  await assert.rejects(() => api.getOrder('ord_1'));
  assert.equal(useAuthStore.getState().accessToken, null);
});

test('does not retry when there is no initData to re-authenticate with', async () => {
  setTelegramInitData(null);
  stubFetch({ beforeReauth: 401, afterReauth: 200 });

  await assert.rejects(() => api.getOrder('ord_1'));
  assert.equal(calls.length, 1);
});

test('leaves unauthenticated endpoints alone on a 401', async () => {
  stubFetch({ beforeReauth: 401, afterReauth: 200 });

  await assert.rejects(() => api.listPaymentMethods());
  assert.equal(calls.length, 1);
});

test('re-authenticates once when a page fires several calls at once', async () => {
  stubFetch({ beforeReauth: 401, afterReauth: 200 });

  await Promise.all([api.getOrder('a'), api.getOrder('b'), api.listOrders()]);

  const authCalls = calls.filter((c) => c.url.endsWith('/auth/telegram'));
  assert.equal(authCalls.length, 1);
});
