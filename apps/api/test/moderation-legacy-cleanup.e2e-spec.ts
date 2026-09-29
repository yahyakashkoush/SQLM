import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Update } from 'grammy/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { BotGuardService, FLOOD_MAX_UPDATES } from '../src/modules/telegram/bot-guard.service';
import { LegacyCustomersService } from '../src/modules/loyalty/legacy-customers.service';
import { normalizePhone } from '../src/modules/loyalty/phone';
import { PaymentProofsService, MAX_PROOFS_PER_ORDER } from '../src/modules/payments/payment-proofs.service';
import { StaffTelegramService } from '../src/modules/telegram/staff-telegram.service';
import { StorageService } from '../src/modules/storage/storage.service';

/** A valid PNG header plus a random tail: passes the magic-byte check, hashes differently each call. */
function pngBytes(tail = Math.random().toString(36)): Buffer {
  return Buffer.concat([
    Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    ]),
    Buffer.from(tail),
  ]);
}

describe('Moderation, anti-fraud, old customers and cleanup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let guard: BotGuardService;
  let legacy: LegacyCustomersService;
  let proofs: PaymentProofsService;

  const overrides: Record<string, number> = {
    'customers.legacyDiscountPercent': 15,
    'customers.verifiedDiscountPercent': 5,
    'customers.welcomeGiftPercent': 10,
  };

  const customerIds: string[] = [];
  const orderIds: string[] = [];
  const productIds: string[] = [];
  const staffIds: string[] = [];
  const legacyPhones: string[] = [];
  let methodId: string;
  let ownerId: string;
  let ownerToken: string;
  let adminToken: string;
  let reviewerToken: string;
  let supportToken: string;

  const token = (sub: string, type: 'customer' | 'staff') =>
    jwt.sign({ sub, type }, { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '1h' });

  const uniqueTelegramId = () => BigInt(Date.now() * 1000 + Math.floor(Math.random() * 1000));

  async function newCustomer(data: { verifiedAt?: Date } = {}) {
    const customer = await prisma.customer.create({ data: { telegramId: uniqueTelegramId(), ...data } });
    customerIds.push(customer.id);
    return { id: customer.id, telegramId: customer.telegramId, token: token(customer.id, 'customer') };
  }

  async function newStaff(role: 'OWNER' | 'ADMIN' | 'PAYMENT_REVIEWER' | 'SUPPORT_AGENT', telegramId?: bigint) {
    const staff = await prisma.staff.create({
      data: {
        email: `mod-e2e-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@sqlm.local`,
        passwordHash: 'x',
        name: `Mod ${role}`,
        role,
        status: 'ACTIVE',
        telegramId,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  async function newProduct(stock = 20, price = 10) {
    const product = await prisma.product.create({
      data: {
        slug: `mod-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: 'Moderation E2E Product',
        price,
        currency: 'USD',
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        fulfillmentType: 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock,
      },
    });
    productIds.push(product.id);
    return product.id;
  }

  async function checkout(customerToken: string, productId: string, quantity = 1) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        items: [{ productId, quantity }],
        paymentMethodId: methodId,
        idempotencyKey: `mod-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
      .expect(201);
    orderIds.push(res.body.id);
    return res.body as { id: string; sequenceNumber: number; total: string; memberDiscountKind: string | null };
  }

  const uploadProof = (customerToken: string, orderId: string, file = pngBytes()) =>
    request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/payment-proof`)
      .set('Authorization', `Bearer ${customerToken}`)
      .attach('file', file, { filename: 'receipt.png', contentType: 'image/png' });

  async function markPaid(orderId: string) {
    for (const toStatus of ['PAYMENT_SUBMITTED', 'PAYMENT_REVIEW', 'PAID']) {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${orderId}/transition`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toStatus })
        .expect(201);
    }
  }

  const stockOf = async (productId: string) =>
    (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    guard = app.get(BotGuardService);
    legacy = app.get(LegacyCustomersService);
    proofs = app.get(PaymentProofsService);

    const settings = app.get(SettingsService);
    const original = settings.getNumber.bind(settings);
    jest
      .spyOn(settings, 'getNumber')
      .mockImplementation(async (key, db) => (key in overrides ? overrides[key]! : original(key, db)));

    const owner = await newStaff('OWNER');
    ownerId = owner.id;
    ownerToken = token(owner.id, 'staff');
    adminToken = token((await newStaff('ADMIN')).id, 'staff');
    reviewerToken = token((await newStaff('PAYMENT_REVIEWER')).id, 'staff');
    supportToken = token((await newStaff('SUPPORT_AGENT')).id, 'staff');

    const method = await prisma.paymentMethod.create({
      data: { name: 'Moderation E2E USD', currency: 'USD', enabled: true, provider: 'MANUAL' },
    });
    methodId = method.id;
  });

  afterAll(async () => {
    await prisma.legacyCustomer.deleteMany({ where: { phone: { in: legacyPhones } } });
    await prisma.paymentProof.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.paymentProof.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.inventoryItem.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.paymentMethod.deleteMany({ where: { id: methodId } });
    await prisma.auditLog.deleteMany({ where: { actorStaffId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  describe('bot flood guard', () => {
    const privateMessage = (updateId: number, userId: number): Update =>
      ({
        update_id: updateId,
        message: {
          message_id: updateId,
          date: 0,
          chat: { id: userId, type: 'private', first_name: 'x' },
          from: { id: userId, is_bot: false, first_name: 'x' },
          text: 'hi',
        },
      }) as unknown as Update;

    it(`lets ${FLOOD_MAX_UPDATES} updates a minute through, warns once, then drops`, async () => {
      const userId = 900_000_000 + Math.floor(Math.random() * 1_000_000);
      await guard.unmute(userId);
      for (let i = 0; i < FLOOD_MAX_UPDATES; i++) {
        expect((await guard.admit(privateMessage(i, userId))).verdict).toBe('accept');
      }
      expect(await guard.admit(privateMessage(100, userId))).toEqual({ verdict: 'warn', chatId: userId });
      expect((await guard.admit(privateMessage(101, userId))).verdict).toBe('drop');

      await guard.unmute(userId);
      expect((await guard.admit(privateMessage(102, userId))).verdict).toBe('accept');
      await guard.unmute(userId);
    });

    it('ignores group and channel traffic outright', async () => {
      const update = {
        update_id: 1,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: -100123, type: 'supergroup', title: 'spam' },
          from: { id: 42, is_bot: false, first_name: 'x' },
          text: '/start',
        },
      } as unknown as Update;
      expect((await guard.admit(update)).verdict).toBe('drop');
    });
  });

  // ---------------------------------------------------------------------------
  describe('banning', () => {
    it('suspends the account, cancels its unpaid orders, returns their stock and rejects pending proofs', async () => {
      const productId = await newProduct(10);
      const customer = await newCustomer();
      const unpaid = await checkout(customer.token, productId, 2);
      const underReview = await checkout(customer.token, productId, 1);
      await uploadProof(customer.token, underReview.id).expect(201);
      const paid = await checkout(customer.token, productId, 1);
      await markPaid(paid.id);
      expect(await stockOf(productId)).toBe(6);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/customers/${customer.id}/ban`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ reason: 'fake receipt' })
        .expect(201);
      expect(res.body.cancelledOrders).toBe(2);

      const saved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(saved.status).toBe('BANNED');
      expect(saved.banReason).toBe('fake receipt');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: unpaid.id } })).status).toBe('CANCELLED');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: underReview.id } })).status).toBe('CANCELLED');
      // Money that really arrived is not undone automatically.
      expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.id } })).status).not.toBe('CANCELLED');
      expect(await stockOf(productId)).toBe(9);
      const proof = await prisma.paymentProof.findFirstOrThrow({ where: { orderId: underReview.id } });
      expect(proof.status).toBe('REJECTED');

      // Every authenticated Mini App call now refuses the old token.
      await request(app.getHttpServer())
        .get('/api/v1/me/perks')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(401);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/customers/${customer.id}/unban`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe('ACTIVE');
      await request(app.getHttpServer())
        .get('/api/v1/me/perks')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);
    });

    it('is refused to a support agent', async () => {
      const customer = await newCustomer();
      await request(app.getHttpServer())
        .post(`/api/v1/admin/customers/${customer.id}/ban`)
        .set('Authorization', `Bearer ${supportToken}`)
        .send({ reason: 'x' })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('payment proof anti-fraud', () => {
    it('flags a screenshot that was already used on another order', async () => {
      const productId = await newProduct();
      const first = await newCustomer();
      const second = await newCustomer();
      const receipt = pngBytes('same-receipt-' + Date.now());

      const firstOrder = await checkout(first.token, productId);
      await uploadProof(first.token, firstOrder.id, receipt).expect(201);
      const secondOrder = await checkout(second.token, productId);
      const uploaded = await uploadProof(second.token, secondOrder.id, receipt).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/payment-proofs/${uploaded.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.risk.duplicates).toEqual([
        { orderId: firstOrder.id, sequenceNumber: firstOrder.sequenceNumber, sameCustomer: false },
      ]);
      expect(res.body.risk.flags[0]).toContain('🚨');
      expect(res.body.risk.flags.join('\n')).toContain(`#${firstOrder.sequenceNumber}`);
    });

    it(`caps an order at ${MAX_PROOFS_PER_ORDER} proofs`, async () => {
      const productId = await newProduct();
      const customer = await newCustomer();
      const order = await checkout(customer.token, productId);
      for (let i = 0; i < MAX_PROOFS_PER_ORDER; i++) {
        const res = await uploadProof(customer.token, order.id).expect(201);
        await proofs.reject(res.body.id, ownerId, 'unclear', false);
      }
      const refused = await uploadProof(customer.token, order.id).expect(429);
      expect(refused.body.code).toBe('TOO_MANY_PROOFS');
    });

    it('"fake + ban" from Telegram rejects, cancels and bans in one tap — only for staff allowed to ban', async () => {
      const productId = await newProduct();
      const customer = await newCustomer();
      const order = await checkout(customer.token, productId);
      const proof = await uploadProof(customer.token, order.id).expect(201);
      const staffTelegram = app.get(StaffTelegramService);

      const supportTg = uniqueTelegramId();
      await newStaff('SUPPORT_AGENT', supportTg);
      expect((await staffTelegram.rejectAsFake(Number(supportTg), proof.body.id)).ok).toBe(false);

      const reviewerTg = uniqueTelegramId();
      await newStaff('PAYMENT_REVIEWER', reviewerTg);
      const outcome = await staffTelegram.rejectAsFake(Number(reviewerTg), proof.body.id);
      expect(outcome.ok).toBe(true);

      expect((await prisma.paymentProof.findUniqueOrThrow({ where: { id: proof.body.id } })).status).toBe('REJECTED');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe('BANNED');
    });
  });

  // ---------------------------------------------------------------------------
  describe('old customers', () => {
    it('normalises the ways a number gets written to one form', () => {
      for (const written of ['01012345678', '+20 101 234 5678', '00201012345678', '201012345678', '1012345678']) {
        expect(normalizePhone(written)).toBe('201012345678');
      }
      expect(normalizePhone('call me')).toBeNull();
      expect(normalizePhone('123')).toBeNull();
    });

    function randomEgyptianNumber() {
      return `010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    }

    it('imports a pasted list, updating repeats and reporting junk', async () => {
      const a = randomEgyptianNumber();
      const b = randomEgyptianNumber();
      legacyPhones.push(normalizePhone(a)!, normalizePhone(b)!);

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/legacy-customers/import')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ text: `${a}, Ahmed\n${b}\tMona\t20\nnot a phone\n${a}, Ahmed Ali, 12` })
        .expect(201);
      expect(res.body).toEqual({ added: 2, updated: 1, invalid: ['not a phone'] });

      const entry = await prisma.legacyCustomer.findUniqueOrThrow({ where: { phone: normalizePhone(a)! } });
      expect(entry.name).toBe('Ahmed Ali');
      expect(entry.discountPercent?.toNumber()).toBe(12);
    });

    it('a matched number gets the old-customer discount on every order, once per number', async () => {
      const raw = randomEgyptianNumber();
      const phone = normalizePhone(raw)!;
      legacyPhones.push(phone);
      await prisma.legacyCustomer.create({ data: { phone, name: 'Old one' } });

      const customer = await newCustomer();
      const claim = await legacy.claim(customer.id, `+${phone}`, 'Old');
      expect(claim.status).toBe('CLAIMED');
      if (claim.status === 'CLAIMED') expect(claim.percent).toBe(15);

      // They bought here before, so they count as verified — but the better discount wins.
      const saved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(saved.verifiedAt).not.toBeNull();
      expect(saved.phone).toBe(phone);

      const productId = await newProduct(10, 20);
      const order = await checkout(customer.token, productId);
      expect(order.memberDiscountKind).toBe('LEGACY');
      expect(Number(order.total)).toBe(17);

      expect((await legacy.claim(customer.id, raw, 'Old')).status).toBe('ALREADY_CLAIMED');
      const someoneElse = await newCustomer();
      expect((await legacy.claim(someoneElse.id, raw, 'X')).status).toBe('TAKEN');
      expect((await legacy.claim(someoneElse.id, randomEgyptianNumber(), 'X')).status).toBe('NOT_FOUND');
    });

    it('a per-number percentage overrides Settings, and a lower one loses to the verified discount', async () => {
      const phone = normalizePhone(randomEgyptianNumber())!;
      legacyPhones.push(phone);
      await prisma.legacyCustomer.create({ data: { phone, discountPercent: 2 } });

      const customer = await newCustomer();
      expect((await legacy.claim(customer.id, phone, null)).status).toBe('CLAIMED');
      const productId = await newProduct(10, 20);
      const order = await checkout(customer.token, productId);
      // 2% old-customer vs 5% verified: the customer gets 5%.
      expect(order.memberDiscountKind).toBe('VERIFIED');
      expect(Number(order.total)).toBe(19);
    });
  });

  // ---------------------------------------------------------------------------
  describe('cleaning up test data', () => {
    it('deleting an unpaid order returns its stock and removes its proof files', async () => {
      const productId = await newProduct(10);
      const customer = await newCustomer();
      const order = await checkout(customer.token, productId, 3);
      const proof = await uploadProof(customer.token, order.id).expect(201);
      const storageKey = (await prisma.paymentProof.findUniqueOrThrow({ where: { id: proof.body.id } })).storageKey;
      expect(await stockOf(productId)).toBe(7);

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/orders/${order.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeNull();
      expect(await prisma.paymentProof.count({ where: { orderId: order.id } })).toBe(0);
      expect(await stockOf(productId)).toBe(10);
      expect(await app.get(StorageService).read(storageKey)).toBeNull();
    });

    it('a cancelled order already gave its stock back, so deleting it does not give it twice', async () => {
      const productId = await newProduct(10);
      const customer = await newCustomer();
      const order = await checkout(customer.token, productId, 2);
      await request(app.getHttpServer())
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${customer.token}`)
        .send({})
        .expect(201);
      expect(await stockOf(productId)).toBe(10);

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/orders/${order.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(await stockOf(productId)).toBe(10);
    });

    it('a paid order goes back to stock only when asked to', async () => {
      const productId = await newProduct(10);
      const customer = await newCustomer();
      const kept = await checkout(customer.token, productId, 1);
      const restocked = await checkout(customer.token, productId, 1);
      await markPaid(kept.id);
      await markPaid(restocked.id);
      expect(await stockOf(productId)).toBe(8);

      await request(app.getHttpServer())
        .post('/api/v1/admin/orders/bulk-delete')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ ids: [kept.id] })
        .expect(201);
      expect(await stockOf(productId)).toBe(8);

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/orders/${restocked.id}?restock=true`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(await stockOf(productId)).toBe(9);
    });

    it('deleting orders is the owner’s call alone', async () => {
      const productId = await newProduct();
      const customer = await newCustomer();
      const order = await checkout(customer.token, productId);
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
      expect(await prisma.order.findUnique({ where: { id: order.id } })).not.toBeNull();
    });

    it('a product can be deleted for good once no order references it', async () => {
      const productId = await newProduct();
      const customer = await newCustomer();
      const order = await checkout(customer.token, productId);

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/products/${productId}/permanent`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/orders/${order.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/products/${productId}/permanent`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(await prisma.product.findUnique({ where: { id: productId } })).toBeNull();
    });
  });
});
