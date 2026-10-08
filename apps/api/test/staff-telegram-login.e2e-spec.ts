import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

function signedInitData(userId: number, ageSeconds = 0, token = BOT_TOKEN): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000) - ageSeconds),
    query_id: 'AAE' + userId,
    user: JSON.stringify({ id: userId, first_name: 'Staff' }),
  };
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

/**
 * The Mini App's admin mode signs staff in with their Telegram session.
 * Only accounts the bot already treats as staff get in, with their own role.
 */
describe('Staff sign-in from the Mini App (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const staffIds: string[] = [];
  const base = 900_000_000 + Math.floor(Math.random() * 90_000_000);
  const agentTelegram = base;
  const strangerTelegram = base + 1;
  const disabledTelegram = base + 2;

  const login = (initData: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/staff/telegram').send({ initData });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    for (const [telegramId, status] of [
      [agentTelegram, 'ACTIVE'],
      [disabledTelegram, 'DISABLED'],
    ] as const) {
      const staff = await prisma.staff.create({
        data: {
          email: `tg-login-${telegramId}@sqlm.local`,
          passwordHash: 'x',
          name: `TG ${status}`,
          role: 'SUPPORT_AGENT',
          status,
          telegramId: BigInt(telegramId),
        },
      });
      staffIds.push(staff.id);
    }
  });

  afterAll(async () => {
    await prisma.staffRefreshToken.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorStaffId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('signs a linked staff account in with its own role and permissions', async () => {
    const res = await login(signedInitData(agentTelegram)).expect(200);
    expect(res.body.staff).toMatchObject({ role: 'SUPPORT_AGENT' });
    expect(res.body.refreshToken).toBeTruthy();
    // The token works on admin routes the role allows, and only those.
    await request(app.getHttpServer())
      .get('/api/v1/admin/customers')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/admin/profits')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(403);
  });

  it('refuses accounts that are not staff, disabled staff, stale or forged sessions', async () => {
    expect((await login(signedInitData(strangerTelegram)).expect(403)).body.code).toBe('NOT_STAFF');
    await login(signedInitData(disabledTelegram)).expect(403);
    await login(signedInitData(agentTelegram, 2 * 3600)).expect(401);
    await login(signedInitData(agentTelegram, 0, '123456:not-our-bot')).expect(401);
  });
});
