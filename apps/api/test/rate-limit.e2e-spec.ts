import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const AUTH_BUDGET_HEADER = 'x-ratelimit-remaining-auth';
const DEFAULT_BUDGET_HEADER = 'x-ratelimit-remaining';

/**
 * Every named throttler is evaluated on every route: `@Throttle({ auth: {} })`
 * on the login handlers overrides that profile's numbers there, it does not
 * scope the profile to them. So the 5-per-minute brute-force budget silently
 * applied to the whole API, and a customer polling their payment page was cut
 * off on the 6th request of any kind. That shipped once.
 *
 * These assert the scoping rather than a request count, so they prove the
 * property regardless of how the limits are tuned in any given environment.
 */
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not spend the brute-force budget on an ordinary endpoint', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/payment-methods');

    // Absent means the auth profile was skipped for this route entirely.
    expect(res.headers[AUTH_BUDGET_HEADER]).toBeUndefined();
    expect(res.headers[DEFAULT_BUDGET_HEADER]).toBeDefined();
  });

  it('still spends it on staff login', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/staff/login')
      .send({ email: 'nobody@sqlm.local', password: 'WrongPassword1!' });
    const second = await request(app.getHttpServer())
      .post('/api/v1/auth/staff/login')
      .send({ email: 'nobody@sqlm.local', password: 'WrongPassword1!' });

    expect(Number(first.headers[AUTH_BUDGET_HEADER])).toBeGreaterThanOrEqual(0);
    expect(Number(second.headers[AUTH_BUDGET_HEADER])).toBeLessThan(
      Number(first.headers[AUTH_BUDGET_HEADER]),
    );
  });

  it('still spends it on Telegram customer auth', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/telegram')
      .send({ initData: 'not-valid' });

    expect(res.headers[AUTH_BUDGET_HEADER]).toBeDefined();
  });

  it('leaves ordinary endpoints working after a burst of failed logins', async () => {
    for (let i = 0; i < 12; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: 'nobody2@sqlm.local', password: 'WrongPassword1!' });
    }

    const res = await request(app.getHttpServer()).get('/api/v1/payment-methods');
    expect(res.status).not.toBe(429);
  });

  it('serves a customer polling their payment page far past the auth budget', async () => {
    // What the Mini App actually does while someone waits on a transfer.
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const res = await request(app.getHttpServer()).get('/api/v1/payment-methods');
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
  });
});
