import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

function buildSignedInitData(fields: Record<string, string>): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const ownerEmail = `e2e-owner-${Date.now()}@sqlm.local`;
  const ownerPassword = 'CorrectHorseBattery9!';
  let ownerId: string;

  const agentEmail = `e2e-agent-${Date.now()}@sqlm.local`;
  const agentPassword = 'AnotherStrongPass9!';
  let agentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);

    const owner = await prisma.staff.create({
      data: {
        email: ownerEmail,
        passwordHash: await argon2.hash(ownerPassword),
        name: 'E2E Owner',
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    ownerId = owner.id;

    const agent = await prisma.staff.create({
      data: {
        email: agentEmail,
        passwordHash: await argon2.hash(agentPassword),
        name: 'E2E Support Agent',
        role: 'SUPPORT_AGENT',
        status: 'ACTIVE',
      },
    });
    agentId = agent.id;
  });

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { id: { in: [ownerId, agentId] } } });
    await prisma.customer.deleteMany({ where: { telegramUsername: 'e2e_test_user' } });
    await app?.close();
  });

  describe('staff login', () => {
    it('rejects an unknown email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: 'nobody@sqlm.local', password: 'whatever123' })
        .expect(401);
    });

    it('rejects a wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: ownerEmail, password: 'wrong-password' })
        .expect(401);
    });

    it('issues an access + refresh token pair for correct credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: ownerEmail, password: ownerPassword })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));
      expect(res.body.staff.email).toBe(ownerEmail);
      expect(res.body.staff.role).toBe('OWNER');
    });
  });

  describe('authenticated staff routes', () => {
    it('rejects /me with no token', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/staff/me').expect(401);
    });

    it('accepts /me with a valid access token', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: ownerEmail, password: ownerPassword });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/staff/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(ownerId);
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the refresh token and invalidates the old one', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: ownerEmail, password: ownerPassword });
      const firstRefreshToken = login.body.refreshToken;

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/staff/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(200);
      expect(refreshed.body.refreshToken).not.toBe(firstRefreshToken);

      // The original (now-rotated) refresh token must no longer work.
      await request(app.getHttpServer())
        .post('/api/v1/auth/staff/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(401);
    });

    it('logout revokes the refresh token', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: ownerEmail, password: ownerPassword });

      await request(app.getHttpServer())
        .post('/api/v1/auth/staff/logout')
        .send({ refreshToken: login.body.refreshToken })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/v1/auth/staff/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(401);
    });
  });

  describe('RBAC permission enforcement', () => {
    it('allows OWNER (has roles.read) to list roles', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: ownerEmail, password: ownerPassword });

      const res = await request(app.getHttpServer())
        .get('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.find((r: { role: string }) => r.role === 'OWNER')).toBeDefined();
    });

    it('denies SUPPORT_AGENT (lacks roles.read) from listing roles', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: agentEmail, password: agentPassword });

      await request(app.getHttpServer())
        .get('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(403);
    });
  });

  describe('Telegram customer auth', () => {
    it('rejects initData with an invalid signature', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/telegram')
        .send({ initData: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef' })
        .expect(401);
    });

    it('authenticates and upserts a customer from valid initData', async () => {
      const initData = buildSignedInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({
          id: 987654321,
          username: 'e2e_test_user',
          first_name: 'E2E',
          language_code: 'en',
        }),
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/telegram')
        .send({ initData })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.customer.telegramId).toBe('987654321');

      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/telegram/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body.telegramId).toBe('987654321');
    });
  });
});
