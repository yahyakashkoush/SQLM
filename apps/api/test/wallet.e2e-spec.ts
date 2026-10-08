import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { E2E_CONTACT } from './fixtures';

const png = () =>
  Buffer.concat([
    Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]),
    Buffer.from(`${Date.now()}-${Math.random()}`),
  ]);

/**
 * The merchant wallet: top-ups reviewed by staff, orders paid from the
 * balance, and the ledger that has to agree with the balance at every step.
 * Also the one-at-a-time bundle endpoints that replaced the whole-list save.
 */
describe('Merchant wallet and bundle endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let currency: string;

  const customerIds: string[] = [];
  const productIds: string[] = [];
  const staffIds: string[] = [];
  let methodId: string;
  let ownerToken: string;
  let supportToken: string;
  let reviewerToken: string;

  const token = (sub: string, type: 'customer' | 'staff') =>
    jwt.sign(
      { sub, type },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '1h' },
    );

  async function newCustomer(merchant: boolean) {
    const customer = await prisma.customer.create({
      data: {
        telegramId: BigInt(Date.now() * 1000 + Math.floor(Math.random() * 1000)),
        ...E2E_CONTACT,
        wholesaleAt: merchant ? new Date() : null,
      },
    });
    customerIds.push(customer.id);
    return { id: customer.id, token: token(customer.id, 'customer') };
  }

  async function newStaff(role: 'OWNER' | 'SUPPORT_AGENT' | 'PAYMENT_REVIEWER') {
    const staff = await prisma.staff.create({
      data: {
        email: `wallet-e2e-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@sqlm.local`,
        passwordHash: 'x',
        name: `Wallet ${role}`,
        role,
        status: 'ACTIVE',
      },
    });
    staffIds.push(staff.id);
    return token(staff.id, 'staff');
  }

  async function newProduct(stock = 50, price = 10) {
    const product = await prisma.product.create({
      data: {
        name: `Wallet E2E ${Date.now()}-${Math.random()}`,
        slug: `wallet-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        price,
        currency,
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        fulfillmentType: 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock,
        costPrice: price / 2,
      },
    });
    productIds.push(product.id);
    return product;
  }

  const topUp = (customerToken: string, amount: number, file = png()) =>
    request(app.getHttpServer())
      .post('/api/v1/wallet/topups')
      .set('Authorization', `Bearer ${customerToken}`)
      .field('amount', String(amount))
      .field('paymentMethodId', methodId)
      .field('senderReference', '01011112222')
      .attach('file', file, { filename: 'r.png', contentType: 'image/png' });

  const review = (id: string, body: object, as = ownerToken) =>
    request(app.getHttpServer())
      .post(`/api/v1/admin/wallet/topups/${id}/review`)
      .set('Authorization', `Bearer ${as}`)
      .send(body);

  const walletCheckout = (customerToken: string, productId: string, quantity = 1) =>
    request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        items: [{ productId, quantity }],
        payWithWallet: true,
        idempotencyKey: `wallet-e2e-${Date.now()}-${Math.random()}`,
      });

  async function fundedMerchant(amount: number) {
    const merchant = await newCustomer(true);
    const created = await topUp(merchant.token, amount).expect(201);
    await review(created.body.id, { approve: true }).expect(201);
    return merchant;
  }

  /** The ledger must always add up to the balance. */
  async function expectLedgerConsistent(customerId: string) {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const sum = await prisma.walletEntry.aggregate({
      where: { customerId },
      _sum: { amount: true },
    });
    expect(Number(sum._sum.amount ?? 0)).toBeCloseTo(Number(customer.walletBalance), 2);
    expect(Number(customer.walletBalance)).toBeGreaterThanOrEqual(0);
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
    currency =
      ((await prisma.platformSetting.findUnique({ where: { key: 'store.defaultCurrency' } }))
        ?.value as string) ?? 'USD';
    ownerToken = await newStaff('OWNER');
    supportToken = await newStaff('SUPPORT_AGENT');
    reviewerToken = await newStaff('PAYMENT_REVIEWER');
    methodId = (
      await prisma.paymentMethod.create({
        data: {
          name: 'Wallet E2E Cash',
          currency,
          enabled: true,
          provider: 'MANUAL',
          accountNumber: '01000000000',
        },
      })
    ).id;
  });

  afterAll(async () => {
    const orders = await prisma.order.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    await prisma.walletEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.walletTopUp.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customerStrike.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.paymentMethod.deleteMany({ where: { id: methodId } });
    await prisma.auditLog.deleteMany({ where: { actorStaffId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('keeps the wallet to approved merchants', async () => {
    const shopper = await newCustomer(false);
    const summary = await request(app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${shopper.token}`)
      .expect(200);
    expect(summary.body).toMatchObject({ enabled: false, balance: '0.00' });
    const refused = await topUp(shopper.token, 50).expect(403);
    expect(refused.body.code).toBe('WALLET_MERCHANTS_ONLY');
    const product = await newProduct();
    const checkout = await walletCheckout(shopper.token, product.id).expect(403);
    expect(checkout.body.code).toBe('WALLET_MERCHANTS_ONLY');
  });

  it('credits a top-up exactly once, for the amount staff approve', async () => {
    const merchant = await newCustomer(true);
    const created = await topUp(merchant.token, 100).expect(201);
    expect(created.body.status).toBe('PENDING');

    // Support agents can't approve money.
    await review(created.body.id, { approve: true }, supportToken).expect(403);

    const [first, second] = await Promise.all([
      review(created.body.id, { approve: true, amount: 90 }, reviewerToken),
      review(created.body.id, { approve: true, amount: 90 }, reviewerToken),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const summary = await request(app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${merchant.token}`)
      .expect(200);
    expect(summary.body).toMatchObject({ enabled: true, balance: '90.00', currency });
    expect(summary.body.entries).toHaveLength(1);
    await expectLedgerConsistent(merchant.id);
  });

  it('refuses a receipt that was already used, and a rejection needs a reason', async () => {
    const merchant = await newCustomer(true);
    const file = png();
    const created = await topUp(merchant.token, 20, file).expect(201);
    const copy = await topUp(merchant.token, 20, file).expect(409);
    expect(copy.body.code).toBe('DUPLICATE_PROOF');

    await review(created.body.id, { approve: false }).expect(400);
    await review(created.body.id, { approve: false, reason: 'مفيش تحويل' }).expect(201);
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: merchant.id } });
    expect(row.walletBalance.toFixed(2)).toBe('0.00');
  });

  it('pays a checkout from the balance and settles it at once', async () => {
    const merchant = await fundedMerchant(50);
    const product = await newProduct(10, 12.5);
    const res = await walletCheckout(merchant.token, product.id, 2).expect(201);
    expect(res.body.walletPaid).toBe(true);
    expect(res.body.paymentMethodId).toBeNull();
    expect(['PAID', 'PROCESSING', 'READY_FOR_DELIVERY', 'DELIVERED', 'COMPLETED']).toContain(
      res.body.status,
    );

    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(order.paidAt).not.toBeNull();
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: merchant.id } });
    expect(customer.walletBalance.toFixed(2)).toBe('25.00');
    const entry = await prisma.walletEntry.findFirstOrThrow({ where: { orderId: order.id } });
    expect(entry).toMatchObject({ type: 'PURCHASE' });
    expect(entry.amount.toFixed(2)).toBe('-25.00');
    await expectLedgerConsistent(merchant.id);

    // The sale shows in the profit report with the cost frozen at checkout.
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items[0]!.unitCost?.toFixed(2)).toBe('6.25');
    const today = new Date().toISOString().slice(0, 10);
    const report = await request(app.getHttpServer())
      .get(`/api/v1/admin/profits?from=${today}&to=${today}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const line = report.body.products.find((p: { id: string }) => p.id === product.id);
    expect(line).toMatchObject({
      revenue: '25.00',
      cost: '12.50',
      profit: '12.50',
      margin: 50,
      units: 2,
    });
    expect(report.body.channels.some((c: { name: string }) => c.name === 'Wallet')).toBe(true);
    await request(app.getHttpServer())
      .get('/api/v1/admin/profits')
      .set('Authorization', `Bearer ${supportToken}`)
      .expect(403);
  });

  it('rolls the whole order back when the balance is short', async () => {
    const merchant = await fundedMerchant(5);
    const product = await newProduct(10, 12.5);
    const res = await walletCheckout(merchant.token, product.id).expect(409);
    expect(res.body.code).toBe('INSUFFICIENT_BALANCE');
    expect(await prisma.order.count({ where: { customerId: merchant.id } })).toBe(0);
    const stock = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stock.stock).toBe(10);
    await expectLedgerConsistent(merchant.id);
  });

  it('lets only one of two racing purchases spend the same money', async () => {
    const merchant = await fundedMerchant(15);
    const product = await newProduct(10, 10);
    const results = await Promise.all([
      walletCheckout(merchant.token, product.id),
      walletCheckout(merchant.token, product.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: merchant.id } });
    expect(customer.walletBalance.toFixed(2)).toBe('5.00');
    const stock = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stock.stock).toBe(9);
    await expectLedgerConsistent(merchant.id);
  });

  it('pays an order that is already waiting for payment', async () => {
    const merchant = await fundedMerchant(30);
    const product = await newProduct(10, 10);
    const created = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${merchant.token}`)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId: methodId,
        idempotencyKey: `w-${Date.now()}`,
      })
      .expect(201);
    expect(created.body.status).toBe('PENDING_PAYMENT');
    const paid = await request(app.getHttpServer())
      .post(`/api/v1/wallet/pay/${created.body.id}`)
      .set('Authorization', `Bearer ${merchant.token}`)
      .expect(201);
    expect(paid.body.walletPaid).toBe(true);
    await request(app.getHttpServer())
      .post(`/api/v1/wallet/pay/${created.body.id}`)
      .set('Authorization', `Bearer ${merchant.token}`)
      .expect(409);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: merchant.id } });
    expect(customer.walletBalance.toFixed(2)).toBe('20.00');
  });

  it('lets an owner adjust a balance but never below zero, and not a support agent', async () => {
    const merchant = await fundedMerchant(10);
    const adjust = (amount: number, as = ownerToken) =>
      request(app.getHttpServer())
        .post(`/api/v1/admin/wallet/customers/${merchant.id}/adjust`)
        .set('Authorization', `Bearer ${as}`)
        .send({ amount, type: 'ADJUSTMENT', note: 'تصحيح' });
    await adjust(5, supportToken).expect(403);
    await adjust(5).expect(201);
    const overdraw = await adjust(-100).expect(409);
    expect(overdraw.body.code).toBe('INSUFFICIENT_BALANCE');
    const ok = await adjust(-15).expect(201);
    expect(ok.body.balance).toBe('0.00');
    const history = await request(app.getHttpServer())
      .get(`/api/v1/admin/wallet/customers/${merchant.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(history.body.entries).toHaveLength(3);
    await expectLedgerConsistent(merchant.id);
  });

  it('saves bundles one at a time and never loses one it was not told about', async () => {
    const product = await newProduct();
    const base = `/api/v1/admin/products/${product.id}/bundles`;
    const add = (body: object) =>
      request(app.getHttpServer())
        .post(base)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(body);

    const a = await add({ quantity: 5, price: 40 }).expect(201);
    const b = await add({ quantity: 10, price: 70, wholesaleOnly: true, label: 'جملة 10' }).expect(
      201,
    );
    expect(b.body.bundles).toHaveLength(2);

    // Same size twice for the same audience is refused; for the other audience it is fine.
    expect((await add({ quantity: 5, price: 39 }).expect(409)).body.code).toBe('BUNDLE_EXISTS');
    await add({ quantity: 5, price: 35, wholesaleOnly: true }).expect(201);

    const edited = await request(app.getHttpServer())
      .patch(`${base}/${a.body.bundle.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ price: 38 })
      .expect(200);
    expect(edited.body.bundles).toHaveLength(3);

    await request(app.getHttpServer())
      .delete(`${base}/${a.body.bundle.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${base}/${a.body.bundle.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ quantity: 3, price: 1 })
      .expect(403);

    // Editing the product itself no longer touches its bundles.
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/products/${product.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `${product.name} (edited)` })
      .expect(200);
    const list = await request(app.getHttpServer())
      .get(base)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.every((x: { wholesaleOnly: boolean }) => x.wholesaleOnly)).toBe(true);
  });
});
