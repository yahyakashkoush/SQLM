import { E2E_CONTACT } from './fixtures';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * A coupon is money given away, so the properties worth testing are the
 * ones about giving away *only* what was intended: never more than the
 * cart is worth, never more often than the caps allow, and never a
 * discount the customer priced themselves.
 */
describe('Coupons (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;

  const PRICE = 100;
  let productId: string;
  let methodId: string;
  const customerIds: string[] = [];
  const orderIds: string[] = [];
  const couponIds: string[] = [];

  function customerToken(customerId: string): string {
    return jwt.sign(
      { sub: customerId, type: 'customer' },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '1h' },
    );
  }

  async function newCustomer() {
    const customer = await prisma.customer.create({
      data: { ...E2E_CONTACT, telegramId: BigInt(Date.now() + Math.floor(Math.random() * 1_000_000)) },
    });
    customerIds.push(customer.id);
    return { id: customer.id, token: customerToken(customer.id) };
  }

  async function makeCoupon(data: Partial<Prisma.CouponCreateInput> = {}) {
    const coupon = await prisma.coupon.create({
      data: {
        code: `E2E${Date.now()}${Math.floor(Math.random() * 1000)}`,
        type: 'PERCENT',
        value: 10,
        ...data,
      } as Prisma.CouponCreateInput,
    });
    couponIds.push(coupon.id);
    return coupon;
  }

  function checkout(token: string, couponCode?: string, quantity = 1) {
    return request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ productId, quantity }],
        paymentMethodId: methodId,
        idempotencyKey: `coupon-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...(couponCode ? { couponCode } : {}),
      });
  }

  function quote(token: string, code: string, quantity = 1) {
    return request(app.getHttpServer())
      .post('/api/v1/coupons/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ code, items: [{ productId, quantity }] });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const product = await prisma.product.create({
      data: {
        slug: `coupon-e2e-${Date.now()}`,
        name: 'Coupon E2E Product',
        price: PRICE,
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        fulfillmentType: 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock: 1000,
      },
    });
    productId = product.id;

    const method = await prisma.paymentMethod.create({
      data: { name: 'Coupon E2E Bank', currency: 'USD', enabled: true, provider: 'MANUAL' },
    });
    methodId = method.id;
  });

  afterAll(async () => {
    await prisma.couponRedemption.deleteMany({ where: { couponId: { in: couponIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.coupon.deleteMany({ where: { id: { in: couponIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.paymentMethod.deleteMany({ where: { id: methodId } });
    await app.close();
  });

  describe('quoting', () => {
    it('prices a percentage against the real cart', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ type: 'PERCENT', value: 25 });

      const res = await quote(customer.token, coupon.code).expect(201);

      expect(res.body.subtotal).toBe('100');
      expect(res.body.discount).toBe('25');
      expect(res.body.total).toBe('75');
    });

    it('matches a code regardless of how it was typed', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon();

      await quote(customer.token, coupon.code.toLowerCase()).expect(201);
      await quote(customer.token, `  ${coupon.code}  `).expect(201);
    });

    it('rejects a code that does not exist', async () => {
      const customer = await newCustomer();
      await quote(customer.token, 'NOSUCHCODE').expect(400);
    });

    it('rejects an expired code', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ endsAt: new Date(Date.now() - 60_000) });
      await quote(customer.token, coupon.code).expect(400);
    });

    it('rejects a code that has not started', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ startsAt: new Date(Date.now() + 60 * 60_000) });
      await quote(customer.token, coupon.code).expect(400);
    });

    it('rejects a deactivated code', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ active: false });
      await quote(customer.token, coupon.code).expect(400);
    });

    it('enforces the minimum order value', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ minSubtotal: 500 });
      await quote(customer.token, coupon.code).expect(400);
      // Three of them clears the minimum.
      await quote(customer.token, coupon.code, 5).expect(201);
    });

    it('caps a percentage at the ceiling the operator set', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ type: 'PERCENT', value: 50, maxDiscount: 20 });

      const res = await quote(customer.token, coupon.code, 4).expect(201);

      // 50% of 400 is 200, but the ceiling is 20.
      expect(res.body.discount).toBe('20');
    });

    it('never discounts more than the cart is worth', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ type: 'FIXED', value: 5000 });

      const res = await quote(customer.token, coupon.code).expect(201);

      expect(res.body.discount).toBe('100');
      expect(Number(res.body.total)).toBe(0);
    });
  });

  describe('redeeming at checkout', () => {
    it('charges the quoted total and records the redemption', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ type: 'FIXED', value: 30 });

      const res = await checkout(customer.token, coupon.code).expect(201);
      orderIds.push(res.body.id);

      expect(res.body.subtotal).toBe('100');
      expect(res.body.discountTotal).toBe('30');
      expect(res.body.total).toBe('70');
      expect(res.body.couponCode).toBe(coupon.code);

      const redemption = await prisma.couponRedemption.findUniqueOrThrow({
        where: { orderId: res.body.id },
      });
      expect(redemption.amount.toString()).toBe('30');

      const after = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.timesRedeemed).toBe(1);
    });

    it('leaves an order without a coupon at full price', async () => {
      const customer = await newCustomer();
      const res = await checkout(customer.token).expect(201);
      orderIds.push(res.body.id);

      expect(res.body.discountTotal).toBe('0');
      expect(res.body.total).toBe(res.body.subtotal);
      expect(res.body.couponCode).toBeNull();
    });

    it('refuses a second use by the same customer', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ perCustomerLimit: 1 });

      const first = await checkout(customer.token, coupon.code).expect(201);
      orderIds.push(first.body.id);

      await checkout(customer.token, coupon.code).expect(400);

      const after = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.timesRedeemed).toBe(1);
    });

    it('allows a second use when the operator permits it', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ perCustomerLimit: 2 });

      const first = await checkout(customer.token, coupon.code).expect(201);
      orderIds.push(first.body.id);
      const second = await checkout(customer.token, coupon.code).expect(201);
      orderIds.push(second.body.id);

      await checkout(customer.token, coupon.code).expect(400);
    });

    it('stops at the global cap even across different customers', async () => {
      const coupon = await makeCoupon({ maxRedemptions: 2, perCustomerLimit: 5 });

      for (let i = 0; i < 2; i++) {
        const customer = await newCustomer();
        const res = await checkout(customer.token, coupon.code).expect(201);
        orderIds.push(res.body.id);
      }

      const late = await newCustomer();
      await checkout(late.token, coupon.code).expect(400);

      const after = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.timesRedeemed).toBe(2);
    });

    it('hands the last use to exactly one of two simultaneous checkouts', async () => {
      const coupon = await makeCoupon({ maxRedemptions: 1, perCustomerLimit: 1 });
      const a = await newCustomer();
      const b = await newCustomer();

      const results = await Promise.all([
        checkout(a.token, coupon.code),
        checkout(b.token, coupon.code),
      ]);

      const created = results.filter((r) => r.status === 201);
      expect(created).toHaveLength(1);
      created.forEach((r) => orderIds.push(r.body.id));

      const after = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.timesRedeemed).toBe(1);
      expect(await prisma.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(1);
    });

    it('gives one customer only one use when they double-submit', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon({ perCustomerLimit: 1, maxRedemptions: 10 });

      const results = await Promise.all([
        checkout(customer.token, coupon.code),
        checkout(customer.token, coupon.code),
      ]);
      results.filter((r) => r.status === 201).forEach((r) => orderIds.push(r.body.id));

      expect(await prisma.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(1);
    });

    it('does not burn the code when the checkout itself fails', async () => {
      const customer = await newCustomer();
      const coupon = await makeCoupon();

      // No stock left: the transaction rolls back after the redemption.
      const scarce = await prisma.product.create({
        data: {
          slug: `coupon-e2e-empty-${Date.now()}`,
          name: 'Out of stock',
          price: 10,
          inventoryMode: 'QUANTITY',
          deliveryType: 'MANUAL',
          fulfillmentType: 'MANUAL_SERVICE',
          status: 'ACTIVE',
          visibility: 'VISIBLE',
          stock: 0,
        },
      });

      await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          items: [{ productId: scarce.id, quantity: 1 }],
          paymentMethodId: methodId,
          idempotencyKey: `coupon-e2e-fail-${Date.now()}`,
          couponCode: coupon.code,
        })
        .expect((res) => {
          if (res.status === 201) throw new Error('checkout should not have succeeded');
        });

      const after = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.timesRedeemed).toBe(0);
      expect(await prisma.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(0);

      await prisma.product.delete({ where: { id: scarce.id } });
    });

    it('rejects a bad code at checkout rather than silently ignoring it', async () => {
      const customer = await newCustomer();
      await checkout(customer.token, 'DEFINITELYNOTREAL').expect(400);
    });
  });

  describe('authorisation', () => {
    it('will not quote for an anonymous visitor', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/coupons/quote')
        .send({ code: 'ANY', items: [{ productId, quantity: 1 }] })
        .expect(401);
    });

    it('will not let a customer reach the admin coupon list', async () => {
      const customer = await newCustomer();
      await request(app.getHttpServer())
        .get('/api/v1/admin/coupons')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(401);
    });
  });
});
