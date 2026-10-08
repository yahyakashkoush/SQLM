import { E2E_CONTACT } from './fixtures';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { NotificationDispatcher } from '../src/modules/notifications/notification-dispatcher.service';

/**
 * Customer tiers, the welcome gift, USD→EGP payment amounts, customer
 * segments, and the payment-method save that used to 500.
 *
 * Discount percentages default to 0 in the database, and other suites run
 * in parallel against it, so this suite turns them on for its own app
 * instance only — by overriding the setting reads in this process —
 * rather than writing global settings every other suite would see.
 */
describe('Loyalty, pricing and segments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;

  const overrides: Record<string, number> = {
    'customers.welcomeGiftPercent': 10,
    'customers.verifiedDiscountPercent': 5,
    'pricing.egpPerUsd': 50,
  };

  const customerIds: string[] = [];
  const orderIds: string[] = [];
  const productIds: string[] = [];
  const methodIds: string[] = [];
  const couponIds: string[] = [];
  let ownerId: string;
  let ownerToken: string;
  let usdMethodId: string;
  let egpMethodId: string;

  const token = (sub: string, type: 'customer' | 'staff') =>
    jwt.sign({ sub, type }, { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '1h' });

  async function newCustomer(data: { verifiedAt?: Date } = {}) {
    const customer = await prisma.customer.create({
      data: { ...E2E_CONTACT, telegramId: BigInt(Date.now() * 1000 + Math.floor(Math.random() * 1000)), ...data },
    });
    customerIds.push(customer.id);
    return { id: customer.id, token: token(customer.id, 'customer') };
  }

  async function newProduct(price: number, stock = 50) {
    const product = await prisma.product.create({
      data: {
        slug: `loyalty-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: 'Loyalty E2E Product',
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

  const quote = (customerToken: string, productId: string, couponCode?: string, quantity = 1) =>
    request(app.getHttpServer())
      .post('/api/v1/orders/quote')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ productId, quantity }], couponCode });

  async function checkout(
    customerToken: string,
    productId: string,
    opts: { methodId?: string; couponCode?: string; expectedTotal?: number; quantity?: number } = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        items: [{ productId, quantity: opts.quantity ?? 1 }],
        paymentMethodId: opts.methodId ?? usdMethodId,
        idempotencyKey: `loyalty-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        couponCode: opts.couponCode,
        expectedTotal: opts.expectedTotal,
      });
    if (res.body?.id) orderIds.push(res.body.id);
    return res;
  }

  const cancel = (customerToken: string, orderId: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({})
      .expect(201);

  /** Walks the state machine's real payment edges; there is no shortcut to PAID. */
  async function markPaid(orderId: string) {
    for (const toStatus of ['PAYMENT_SUBMITTED', 'PAYMENT_REVIEW', 'PAID']) {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${orderId}/transition`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toStatus })
        .expect(201);
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const settings = app.get(SettingsService);
    const original = settings.getNumber.bind(settings);
    jest
      .spyOn(settings, 'getNumber')
      .mockImplementation(async (key, db) => (key in overrides ? overrides[key]! : original(key, db)));

    const owner = await prisma.staff.create({
      data: {
        email: `loyalty-e2e-owner-${Date.now()}@sqlm.local`,
        passwordHash: 'x',
        name: 'Loyalty Owner',
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    ownerId = owner.id;
    ownerToken = token(owner.id, 'staff');

    const usd = await prisma.paymentMethod.create({
      data: { name: 'Loyalty E2E USD', currency: 'USD', enabled: true, provider: 'MANUAL' },
    });
    const egp = await prisma.paymentMethod.create({
      data: { name: 'Loyalty E2E Vodafone Cash', currency: 'EGP', enabled: true, provider: 'MANUAL' },
    });
    usdMethodId = usd.id;
    egpMethodId = egp.id;
    methodIds.push(usd.id, egp.id);
  });

  afterAll(async () => {
    await prisma.couponRedemption.deleteMany({ where: { couponId: { in: couponIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.coupon.deleteMany({ where: { id: { in: couponIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.paymentMethod.deleteMany({ where: { id: { in: methodIds } } });
    await prisma.auditLog.deleteMany({ where: { actorStaffId: ownerId } });
    await prisma.staff.deleteMany({ where: { id: ownerId } });
    await app.close();
  });

  describe('payment methods', () => {
    it('saves a manual method sent with null crypto fields (the admin form payload) instead of a 500', async () => {
      const method = await prisma.paymentMethod.create({
        data: { name: 'Loyalty E2E Bank', currency: 'EGP', enabled: true, provider: 'MANUAL' },
      });
      methodIds.push(method.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/payment-methods/${method.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        // Exactly what the dashboard sends for a bank/IBAN method.
        .send({
          name: 'Loyalty E2E Bank',
          description: null,
          accountNumber: 'EG380019000500000000263180002',
          instructions: null,
          qrCodeUrl: null,
          currency: 'EGP',
          enabled: true,
          displayOrder: 0,
          provider: 'MANUAL',
          cryptoAsset: null,
          cryptoNetwork: null,
          depositAddress: null,
          watchTtlMinutes: 60,
        })
        .expect(200);

      expect(res.body.accountNumber).toBe('EG380019000500000000263180002');
      expect(res.body.cryptoAsset).toBeNull();
    });
  });

  describe('welcome gift', () => {
    it('is quoted and applied to a regular customer’s first order, with no code', async () => {
      const customer = await newCustomer();
      const productId = await newProduct(20);

      const q = await quote(customer.token, productId).expect(200);
      expect(q.body.member).toEqual({ kind: 'WELCOME', percent: 10, amount: '2' });
      expect(q.body.total).toBe('18');

      const res = await checkout(customer.token, productId, { expectedTotal: 18 });
      expect(res.status).toBe(201);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(order.memberDiscountKind).toBe('WELCOME');
      expect(order.memberDiscount.toString()).toBe('2');
      expect(order.discountTotal.toString()).toBe('2');
      expect(order.total.toString()).toBe('18');

      const row = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(row.welcomeGiftOrderId).toBe(order.id);
    });

    it('is held by an unpaid order, so a second order gets no gift', async () => {
      const customer = await newCustomer();
      const productId = await newProduct(20);
      await checkout(customer.token, productId);

      const q = await quote(customer.token, productId).expect(200);
      expect(q.body.member).toBeNull();
      expect(q.body.total).toBe('20');

      const perks = await request(app.getHttpServer())
        .get('/api/v1/me/perks')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);
      expect(perks.body.tier).toBe('REGULAR');
      expect(perks.body.welcomeGift).toMatchObject({ percent: 10, available: false });
    });

    it('comes back when the gifted order is cancelled', async () => {
      const customer = await newCustomer();
      const productId = await newProduct(20);
      const first = await checkout(customer.token, productId);
      await cancel(customer.token, first.body.id);

      const row = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(row.welcomeGiftOrderId).toBeNull();
      const q = await quote(customer.token, productId).expect(200);
      expect(q.body.member?.kind).toBe('WELCOME');
    });

    it('goes to exactly one of two simultaneous first orders; the other is told the price changed', async () => {
      const customer = await newCustomer();
      const productId = await newProduct(20);

      const [a, b] = await Promise.all([
        checkout(customer.token, productId, { expectedTotal: 18 }),
        checkout(customer.token, productId, { expectedTotal: 18 }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.code).toBe('PRICE_CHANGED');

      const gifted = await prisma.order.count({
        where: { customerId: customer.id, memberDiscountKind: 'WELCOME' },
      });
      expect(gifted).toBe(1);
      // The losing checkout rolled back entirely — no stray order, no stock held.
      expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
      const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
      expect(product.stock).toBe(49);
    });
  });

  describe('verified customers', () => {
    it('are verified by their first paid order and get the standing discount from then on', async () => {
      const customer = await newCustomer();
      const productId = await newProduct(20);
      const first = await checkout(customer.token, productId);
      await markPaid(first.body.id);

      const row = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(row.verifiedAt).not.toBeNull();

      const q = await quote(customer.token, productId).expect(200);
      expect(q.body.member).toEqual({ kind: 'VERIFIED', percent: 5, amount: '1' });
      expect(q.body.total).toBe('19');

      const perks = await request(app.getHttpServer())
        .get('/api/v1/me/perks')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);
      expect(perks.body.tier).toBe('VERIFIED');
      expect(perks.body.welcomeGift).toBeNull();
    });

    it('keeps the first verification time on later payments', async () => {
      const verifiedAt = new Date('2026-01-01T00:00:00Z');
      const customer = await newCustomer({ verifiedAt });
      const productId = await newProduct(20);
      const order = await checkout(customer.token, productId);
      await markPaid(order.body.id);

      const row = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(row.verifiedAt?.toISOString()).toBe(verifiedAt.toISOString());
    });

    it('can be granted and revoked by staff, with an audit entry', async () => {
      const customer = await newCustomer();
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/customers/${customer.id}/verification`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ verified: true })
        .expect(200);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).verifiedAt).not.toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/customers/${customer.id}/verification`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ verified: false })
        .expect(200);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).verifiedAt).toBeNull();

      const audits = await prisma.auditLog.count({ where: { entityId: customer.id, actorStaffId: ownerId } });
      expect(audits).toBe(2);
    });
  });

  describe('pricing', () => {
    it('applies a coupon after the member discount, never below zero', async () => {
      const customer = await newCustomer({ verifiedAt: new Date() });
      const productId = await newProduct(20);
      const coupon = await prisma.coupon.create({
        data: { code: `LOYAL${Date.now()}`, type: 'PERCENT', value: 10 },
      });
      couponIds.push(coupon.id);

      // 20 − 5% (1) = 19, then 10% of 19 = 1.9 → 17.1
      const q = await quote(customer.token, productId, coupon.code).expect(200);
      expect(q.body.member.amount).toBe('1');
      expect(q.body.coupon).toEqual({ code: coupon.code, discount: '1.9' });
      expect(q.body.discountTotal).toBe('2.9');
      expect(q.body.total).toBe('17.1');

      const res = await checkout(customer.token, productId, { couponCode: coupon.code, expectedTotal: 17.1 });
      expect(res.status).toBe(201);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(order.total.toString()).toBe('17.1');
      expect(order.discountTotal.toString()).toBe('2.9');
    });

    it('refuses to charge a total other than the one the customer was shown', async () => {
      const customer = await newCustomer();
      const productId = await newProduct(20);
      const res = await checkout(customer.token, productId, { expectedTotal: 20 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PRICE_CHANGED');
      expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(0);
    });

    it('gives the EGP transfer amount for an EGP method, frozen with its rate on the order', async () => {
      const customer = await newCustomer({ verifiedAt: new Date() });
      overrides['customers.verifiedDiscountPercent'] = 0;
      try {
        const productId = await newProduct(3);

        const q = await quote(customer.token, productId).expect(200);
        const egp = q.body.paymentOptions.find((o: { paymentMethodId: string }) => o.paymentMethodId === egpMethodId);
        const usd = q.body.paymentOptions.find((o: { paymentMethodId: string }) => o.paymentMethodId === usdMethodId);
        expect(egp).toEqual({ paymentMethodId: egpMethodId, currency: 'EGP', amount: '150', rate: '50' });
        expect(usd).toEqual({ paymentMethodId: usdMethodId, currency: 'USD', amount: '3', rate: null });

        const res = await checkout(customer.token, productId, { methodId: egpMethodId, expectedTotal: 3 });
        expect(res.status).toBe(201);
        const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
        expect(order.currency).toBe('USD');
        expect(order.total.toString()).toBe('3');
        expect(order.payCurrency).toBe('EGP');
        expect(order.payAmount?.toString()).toBe('150');
        expect(order.exchangeRate?.toString()).toBe('50');

        // A later rate change must not move what an existing order asks for.
        overrides['pricing.egpPerUsd'] = 55;
        const after = await request(app.getHttpServer())
          .get(`/api/v1/orders/${order.id}`)
          .set('Authorization', `Bearer ${customer.token}`)
          .expect(200);
        expect(after.body.payAmount).toBe('150');
      } finally {
        overrides['customers.verifiedDiscountPercent'] = 5;
        overrides['pricing.egpPerUsd'] = 50;
      }
    });

    it('never converts a crypto method into EGP, whatever its currency field says', async () => {
      const customer = await newCustomer({ verifiedAt: new Date() });
      overrides['customers.verifiedDiscountPercent'] = 0;
      const crypto = await prisma.paymentMethod.create({
        data: {
          name: 'Loyalty E2E USDT (mislabelled EGP)',
          currency: 'EGP',
          enabled: true,
          provider: 'BINANCE',
          cryptoAsset: 'USDT',
          cryptoNetwork: 'TRX',
          depositAddress: 'TLoyaltyE2EAddress000000000000000',
        },
      });
      methodIds.push(crypto.id);
      try {
        const productId = await newProduct(3);
        const q = await quote(customer.token, productId).expect(200);
        const option = q.body.paymentOptions.find((o: { paymentMethodId: string }) => o.paymentMethodId === crypto.id);
        expect(option).toEqual({ paymentMethodId: crypto.id, currency: 'USD', amount: '3', rate: null });
      } finally {
        overrides['customers.verifiedDiscountPercent'] = 5;
        await prisma.paymentMethod.update({ where: { id: crypto.id }, data: { enabled: false } });
      }
    });

    it('rounds an EGP amount up to a whole pound', async () => {
      const customer = await newCustomer({ verifiedAt: new Date() });
      overrides['customers.verifiedDiscountPercent'] = 0;
      try {
        const productId = await newProduct(2.99);
        const q = await quote(customer.token, productId).expect(200);
        const egp = q.body.paymentOptions.find((o: { paymentMethodId: string }) => o.paymentMethodId === egpMethodId);
        // 2.99 × 50 = 149.5 → 150; nobody sends piastres by wallet.
        expect(egp.amount).toBe('150');
      } finally {
        overrides['customers.verifiedDiscountPercent'] = 5;
      }
    });

    it('refuses a rate or percentage outside its bounds when saving settings', async () => {
      for (const [key, value] of [
        ['pricing.egpPerUsd', 0],
        ['customers.verifiedDiscountPercent', 150],
        ['customers.welcomeGiftPercent', 'ten'],
      ] as const) {
        await request(app.getHttpServer())
          .patch(`/api/v1/admin/settings/${key}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ value })
          .expect(400);
      }
    });
  });

  describe('coupon uses on cancelled orders', () => {
    it('hands the use back, so a one-use code works again', async () => {
      const customer = await newCustomer({ verifiedAt: new Date() });
      const productId = await newProduct(20);
      const coupon = await prisma.coupon.create({
        data: { code: `BACK${Date.now()}`, type: 'FIXED', value: 2, perCustomerLimit: 1, maxRedemptions: 1 },
      });
      couponIds.push(coupon.id);

      const first = await checkout(customer.token, productId, { couponCode: coupon.code });
      expect(first.status).toBe(201);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).timesRedeemed).toBe(1);

      await cancel(customer.token, first.body.id);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).timesRedeemed).toBe(0);

      const again = await checkout(customer.token, productId, { couponCode: coupon.code });
      expect(again.status).toBe(201);
    });

    it('still enforces the per-customer cap after a use in the middle is handed back', async () => {
      const customer = await newCustomer({ verifiedAt: new Date() });
      const productId = await newProduct(20);
      const coupon = await prisma.coupon.create({
        data: { code: `GAP${Date.now()}`, type: 'FIXED', value: 1, perCustomerLimit: 2 },
      });
      couponIds.push(coupon.id);

      const a = await checkout(customer.token, productId, { couponCode: coupon.code });
      const b = await checkout(customer.token, productId, { couponCode: coupon.code });
      expect([a.status, b.status]).toEqual([201, 201]);
      await cancel(customer.token, a.body.id);

      // Ordinal 1 is free again but 2 is taken: count + 1 would collide here.
      const c = await checkout(customer.token, productId, { couponCode: coupon.code });
      expect(c.status).toBe(201);
      const d = await checkout(customer.token, productId, { couponCode: coupon.code });
      expect(d.status).toBe(400);
    });
  });

  describe('segments', () => {
    it('sorts customers into the right audiences', async () => {
      const verifiedBuyer = await newCustomer();
      const neverBought = await newCustomer();
      const dormant = await newCustomer({ verifiedAt: new Date('2026-01-01') });
      const productId = await newProduct(5);

      const paid = await checkout(verifiedBuyer.token, productId);
      await markPaid(paid.body.id);
      const old = await checkout(dormant.token, productId);
      await markPaid(old.body.id);
      await prisma.order.update({
        where: { id: old.body.id },
        data: { paidAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
      });

      const ids = async (segment: string) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/admin/customers?segment=${segment}&pageSize=100&search=`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);
        const found = new Set((res.body.items as Array<{ id: string }>).map((c) => c.id));
        // Paging: other suites' customers exist too, so re-check by id.
        const members = await prisma.customer.findMany({
          where: { id: { in: [verifiedBuyer.id, neverBought.id, dormant.id] } },
          select: { id: true },
        });
        return members.filter((m) => found.has(m.id)).map((m) => m.id);
      };

      expect(await ids('VERIFIED')).toEqual(expect.arrayContaining([verifiedBuyer.id, dormant.id]));
      expect(await ids('VERIFIED')).not.toContain(neverBought.id);
      expect(await ids('NON_BUYERS')).toContain(neverBought.id);
      expect(await ids('NON_BUYERS')).not.toContain(verifiedBuyer.id);
      expect(await ids('DORMANT')).toContain(dormant.id);
      expect(await ids('DORMANT')).not.toContain(verifiedBuyer.id);

      const counts = await request(app.getHttpServer())
        .get('/api/v1/admin/customers/segments')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(counts.body.map((row: { segment: string }) => row.segment)).toEqual([
        'ALL',
        'VERIFIED',
        'REGULAR',
        'BUYERS',
        'NON_BUYERS',
        'DORMANT',
        'WHOLESALE',
      ]);
    });

    it('broadcasts only to the chosen audience', async () => {
      const verified = await newCustomer({ verifiedAt: new Date() });
      const regular = await newCustomer();

      const dispatcher = app.get(NotificationDispatcher);
      const queue = (dispatcher as unknown as { queue: { addBulk: (jobs: unknown[]) => Promise<unknown> } }).queue;
      const recipients: string[] = [];
      const spy = jest.spyOn(queue, 'addBulk').mockImplementation(async (jobs: unknown[]) => {
        for (const job of jobs as Array<{ data: { customerId: string } }>) recipients.push(job.data.customerId);
        return [];
      });

      try {
        const res = await request(app.getHttpServer())
          .post('/api/v1/admin/notifications/broadcast')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ message: 'For verified customers only', segment: 'VERIFIED' })
          .expect(201);
        expect(res.body.segment).toBe('VERIFIED');
        expect(recipients).toContain(verified.id);
        expect(recipients).not.toContain(regular.id);
        expect(res.body.sent).toBe(recipients.length);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
