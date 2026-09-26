import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RedisService } from '../src/modules/redis/redis.service';
import { QUEUE_NAMES } from '../src/modules/queue/queue-names';

/**
 * Covers the part of the Telegram adapter that's actually verifiable in
 * this environment: webhook validation, idempotent enqueueing, and the
 * DB-level idempotency ledger. Real message delivery (grammy calling
 * api.telegram.org) is not exercised here — this sandbox has no route to
 * Telegram's API, and TelegramBotService intentionally skips that network
 * call under NODE_ENV=test (see telegram-bot.service.ts).
 */
describe('Telegram webhook (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let queue: Queue;

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || 'dev-webhook-secret';
  const webhookPath = `/api/v1/telegram/webhook/${webhookSecret}`;

  function buildUpdate(updateId: number) {
    return {
      update_id: updateId,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'E2E', username: 'e2e_webhook_user' },
        text: '/start',
      },
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    queue = app.get(getQueueToken(QUEUE_NAMES.TELEGRAM_UPDATES));
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { telegramUsername: 'e2e_webhook_user' } });
    await app?.close();
  });

  afterEach(async () => {
    await queue.obliterate({ force: true });
  });

  it('rejects a request with the wrong path secret', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/telegram/webhook/wrong-secret')
      .set('x-telegram-bot-api-secret-token', webhookSecret)
      .send(buildUpdate(900001))
      .expect(403);
  });

  it('rejects a request missing the header secret token', async () => {
    await request(app.getHttpServer()).post(webhookPath).send(buildUpdate(900002)).expect(403);
  });

  it('rejects a request with a mismatched header secret token', async () => {
    await request(app.getHttpServer())
      .post(webhookPath)
      .set('x-telegram-bot-api-secret-token', 'not-the-right-value')
      .send(buildUpdate(900003))
      .expect(403);
  });

  it('rejects a payload with no update_id', async () => {
    await request(app.getHttpServer())
      .post(webhookPath)
      .set('x-telegram-bot-api-secret-token', webhookSecret)
      .send({ message: { text: 'hi' } })
      .expect(400);
  });

  it('accepts a valid update and enqueues exactly one job', async () => {
    const updateId = 900004;
    await request(app.getHttpServer())
      .post(webhookPath)
      .set('x-telegram-bot-api-secret-token', webhookSecret)
      .send(buildUpdate(updateId))
      .expect(200)
      .expect({ ok: true });

    const job = await queue.getJob(`telegram-update-${updateId}`);
    expect(job).not.toBeNull();
    expect((job!.data as { update_id: number }).update_id).toBe(updateId);
  });

  it('does not enqueue a second job for a duplicate update_id (Redis claim)', async () => {
    const updateId = 900005;
    const send = () =>
      request(app.getHttpServer())
        .post(webhookPath)
        .set('x-telegram-bot-api-secret-token', webhookSecret)
        .send(buildUpdate(updateId))
        .expect(200);

    await send();
    await send();
    await send();

    const counts = await queue.getJobCounts();
    const totalJobs = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(totalJobs).toBe(1);
  });

  it('the Redis idempotency claim actually blocks a raw duplicate claim attempt', async () => {
    const key = 'telegram:update:900099';
    const first = await redis.claimOnce(key, 60);
    const second = await redis.claimOnce(key, 60);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('the worker is idempotent at the DB layer too: a pre-existing TelegramUpdateLog row is never duplicated', async () => {
    // Simulates the second line of defense (processor-side) directly,
    // since the worker itself needs a live Telegram connection to run
    // handleUpdate() end-to-end in this environment.
    const updateId = 900006n;
    await prisma.telegramUpdateLog.create({ data: { updateId, status: 'COMPLETED' } });

    await expect(
      prisma.telegramUpdateLog.create({ data: { updateId, status: 'PROCESSING' } }),
    ).rejects.toThrow();

    const count = await prisma.telegramUpdateLog.count({ where: { updateId } });
    expect(count).toBe(1);

    await prisma.telegramUpdateLog.deleteMany({ where: { updateId } });
  });
});
