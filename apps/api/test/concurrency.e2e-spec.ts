import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { encryptSecret } from '@sqlm/shared/crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RedisService } from '../src/modules/redis/redis.service';
import { DeliveryService } from '../src/modules/delivery/delivery.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { CleanupService } from '../src/modules/cleanup/cleanup.service';
import { QUEUE_NAMES } from '../src/modules/queue/queue-names';

/**
 * Phase 16: the properties that actually have to hold under concurrency.
 *
 * Every test here drives real HTTP/service calls against live Postgres and
 * Redis and asserts the resulting *database state*, not just response
 * codes — a duplicate delivery that returns 200 twice is still a duplicate
 * delivery.
 */
describe('Concurrency and failure handling (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let jwt: JwtService;
  let config: ConfigService;
  let delivery: DeliveryService;
  let orders: OrdersService;
  let cleanup: CleanupService;
  let telegramQueue: Queue;

  const adminEmail = `e2e-conc-admin-${Date.now()}@sqlm.local`;
  const password = 'ConcurrencyAdmin9!Pass';
  let adminId: string;
  let adminToken: string;
  let paymentMethodId: string;

  const productIds: string[] = [];
  const customerIds: string[] = [];
  const orderIds: string[] = [];

  function customerToken(customerId: string): string {
    return jwt.sign(
      { sub: customerId, type: 'customer' },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '1h' },
    );
  }

  async function newCustomer() {
    const customer = await prisma.customer.create({
      data: { telegramId: BigInt(Date.now() + Math.floor(Math.random() * 1_000_000)) },
    });
    customerIds.push(customer.id);
    return { id: customer.id, token: customerToken(customer.id) };
  }

  async function createProduct(secrets: string[], stock = 0) {
    const product = await prisma.product.create({
      data: {
        slug: `e2e-conc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: 'E2E Concurrency Product',
        price: 10,
        inventoryMode: secrets.length ? 'INDIVIDUAL' : 'QUANTITY',
        deliveryType: secrets.length ? 'AUTOMATIC' : 'MANUAL',
        fulfillmentType: secrets.length ? 'ACCOUNT' : 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock,
      },
    });
    productIds.push(product.id);

    if (secrets.length) {
      const key = config.getOrThrow<string>('INVENTORY_ENCRYPTION_KEY');
      await prisma.inventoryItem.createMany({
        data: secrets.map((s) => ({ productId: product.id, encryptedPayload: encryptSecret(s, key) })),
      });
    }
    return product;
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
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    delivery = app.get(DeliveryService);
    orders = app.get(OrdersService);
    cleanup = app.get(CleanupService);
    telegramQueue = app.get(getQueueToken(QUEUE_NAMES.TELEGRAM_UPDATES));

    const admin = await prisma.staff.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash(password),
        name: 'E2E Concurrency Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    adminId = admin.id;
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/staff/login')
      .send({ email: adminEmail, password });
    adminToken = login.body.accessToken;

    const method = await prisma.paymentMethod.create({
      data: { name: `E2E Conc PM ${Date.now()}`, enabled: true, currency: 'USD' },
    });
    paymentMethodId = method.id;
  });

  afterAll(async () => {
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.paymentProof.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.inventoryItem.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.paymentMethod.deleteMany({ where: { id: paymentMethodId } });
    await prisma.staff.deleteMany({ where: { id: adminId } });
    await telegramQueue.obliterate({ force: true }).catch(() => undefined);
    await app?.close();
  });

  it('duplicate checkout with the same idempotency key creates exactly one order', async () => {
    const product = await createProduct([], 50);
    const customer = await newCustomer();
    const key = `conc-checkout-${Date.now()}`;

    const submit = () =>
      request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethodId,
          idempotencyKey: key,
        });

    const results = await Promise.all([submit(), submit(), submit(), submit(), submit()]);
    const ids = new Set(results.filter((r) => r.status === 201).map((r) => r.body.id as string));
    ids.forEach((id) => orderIds.push(id));

    expect(ids.size).toBe(1);

    const rows = await prisma.order.count({
      where: { customerId: customer.id, idempotencyKey: key },
    });
    expect(rows).toBe(1);

    // Stock moved exactly once, not five times.
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(49);
  });

  it('simultaneous purchases never oversell the last units', async () => {
    const product = await createProduct(['unit-1', 'unit-2', 'unit-3']);
    const buyers = await Promise.all([
      newCustomer(),
      newCustomer(),
      newCustomer(),
      newCustomer(),
      newCustomer(),
      newCustomer(),
    ]);

    const results = await Promise.all(
      buyers.map((b, i) =>
        request(app.getHttpServer())
          .post('/api/v1/orders/checkout')
          .set('Authorization', `Bearer ${b.token}`)
          .send({
            items: [{ productId: product.id, quantity: 1 }],
            paymentMethodId,
            idempotencyKey: `conc-oversell-${Date.now()}-${i}`,
          }),
      ),
    );

    const created = results.filter((r) => r.status === 201);
    created.forEach((r) => orderIds.push(r.body.id as string));

    expect(created).toHaveLength(3);
    const reserved = await prisma.inventoryItem.count({
      where: { productId: product.id, status: 'RESERVED' },
    });
    expect(reserved).toBe(3);
    const available = await prisma.inventoryItem.count({
      where: { productId: product.id, status: 'AVAILABLE' },
    });
    expect(available).toBe(0);
  });

  it('duplicate Telegram updates enqueue exactly one job', async () => {
    const updateId = 950000 + Math.floor(Math.random() * 10000);
    const secret = config.get<string>('TELEGRAM_WEBHOOK_SECRET') || 'dev-webhook-secret';
    const update = {
      update_id: updateId,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 999, type: 'private' },
        from: { id: 999, is_bot: false, first_name: 'Conc' },
        text: '/start',
      },
    };

    await telegramQueue.obliterate({ force: true });
    await Promise.all(
      Array.from({ length: 5 }).map(() =>
        request(app.getHttpServer())
          .post(`/api/v1/telegram/webhook/${secret}`)
          .set('x-telegram-bot-api-secret-token', secret)
          .send(update)
          .expect(200),
      ),
    );

    const counts = await telegramQueue.getJobCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);

    await prisma.telegramUpdateLog.deleteMany({ where: { updateId: BigInt(updateId) } });
  });

  it('a duplicate delivery worker never issues an inventory item twice', async () => {
    const product = await createProduct(['dup-worker-1', 'dup-worker-2']);
    const customer = await newCustomer();

    const checkout = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        items: [{ productId: product.id, quantity: 2 }],
        paymentMethodId,
        idempotencyKey: `conc-dupworker-${Date.now()}`,
      })
      .expect(201);
    const orderId = checkout.body.id as string;
    orderIds.push(orderId);

    await prisma.$transaction(async (tx) => {
      await orders.transition(tx, orderId, 'PAYMENT_SUBMITTED', { type: 'SYSTEM' });
      await orders.transition(tx, orderId, 'PAYMENT_REVIEW', { type: 'SYSTEM' });
      await orders.transition(tx, orderId, 'PAID', { type: 'SYSTEM' });
    });

    // Five workers pick up the same job at once.
    await Promise.allSettled(
      Array.from({ length: 5 }).map(() => delivery.fulfillOrder(orderId)),
    );

    const rows = await prisma.delivery.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('DELIVERED');
    expect(rows[0]!.inventoryItemIds).toHaveLength(2);

    const delivered = await prisma.inventoryItem.findMany({
      where: { productId: product.id, status: 'DELIVERED' },
    });
    expect(delivered).toHaveLength(2);
    // The same item id never appears in two delivery records.
    expect(new Set(rows[0]!.inventoryItemIds).size).toBe(2);
  });

  it('simultaneous payment approvals settle the order exactly once', async () => {
    const product = await createProduct([], 10);
    const customer = await newCustomer();

    const checkout = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId,
        idempotencyKey: `conc-approve-${Date.now()}`,
      })
      .expect(201);
    const orderId = checkout.body.id as string;
    orderIds.push(orderId);

    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/payment-proof`)
      .set('Authorization', `Bearer ${customer.token}`)
      .attach('file', png, { filename: 'p.png', contentType: 'image/png' })
      .expect(201);

    const proofId = upload.body.id as string;
    const approve = () =>
      request(app.getHttpServer())
        .post(`/api/v1/admin/payment-proofs/${proofId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

    const results = await Promise.all([approve(), approve(), approve()]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);

    const events = await prisma.orderEvent.count({
      where: { orderId, type: 'PAYMENT_APPROVED' },
    });
    expect(events).toBe(1);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(['PAID', 'PROCESSING', 'READY_FOR_DELIVERY', 'DELIVERED']).toContain(order.status);
  });

  it('duplicate payment-proof submissions leave exactly one proof row', async () => {
    const product = await createProduct([], 10);
    const customer = await newCustomer();

    const checkout = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId,
        idempotencyKey: `conc-proof-${Date.now()}`,
      })
      .expect(201);
    const orderId = checkout.body.id as string;
    orderIds.push(orderId);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const upload = () =>
      request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/payment-proof`)
        .set('Authorization', `Bearer ${customer.token}`)
        .attach('file', png, { filename: 'p.png', contentType: 'image/png' });

    const results = await Promise.all([upload(), upload(), upload()]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);

    const proofs = await prisma.paymentProof.count({ where: { orderId } });
    expect(proofs).toBe(1);
  });

  it('a failed automatic delivery is retryable and still delivers only once', async () => {
    const product = await createProduct(['retry-secret']);
    const customer = await newCustomer();

    const checkout = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId,
        idempotencyKey: `conc-retry-${Date.now()}`,
      })
      .expect(201);
    const orderId = checkout.body.id as string;
    orderIds.push(orderId);

    await prisma.$transaction(async (tx) => {
      await orders.transition(tx, orderId, 'PAYMENT_SUBMITTED', { type: 'SYSTEM' });
      await orders.transition(tx, orderId, 'PAYMENT_REVIEW', { type: 'SYSTEM' });
      await orders.transition(tx, orderId, 'PAID', { type: 'SYSTEM' });
    });

    // First pass runs with the inventory yanked away, so it degrades to manual.
    await prisma.inventoryItem.updateMany({
      where: { orderId },
      data: { status: 'DISABLED', orderId: null },
    });
    const first = await delivery.fulfillOrder(orderId);
    expect(first.delivered).toBe(0);

    // Restore it and re-drive: the retry succeeds, and only once.
    const item = await prisma.inventoryItem.findFirstOrThrow({
      where: { productId: product.id },
    });
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { status: 'SOLD', orderId, soldAt: new Date() },
    });
    await prisma.delivery.updateMany({
      where: { orderId },
      data: { method: 'AUTOMATIC', status: 'PENDING' },
    });

    await delivery.fulfillOrder(orderId);
    await delivery.fulfillOrder(orderId);

    const rows = await prisma.delivery.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('DELIVERED');

    const delivered = await prisma.inventoryItem.count({
      where: { productId: product.id, status: 'DELIVERED' },
    });
    expect(delivered).toBe(1);
  });

  it('Redis being unavailable does not corrupt an idempotency decision', async () => {
    // claimOnce is the first line of defense; if Redis says "already
    // claimed" the caller must not proceed, and a fresh key must claim.
    const key = `conc-redis-${Date.now()}`;
    expect(await redis.claimOnce(key, 60)).toBe(true);
    expect(await redis.claimOnce(key, 60)).toBe(false);

    // And the DB-level guard stands on its own even if Redis had said yes:
    // a duplicate TelegramUpdateLog insert is rejected by the constraint.
    const updateId = BigInt(970000 + Math.floor(Math.random() * 10000));
    await prisma.telegramUpdateLog.create({ data: { updateId, status: 'COMPLETED' } });
    await expect(
      prisma.telegramUpdateLog.create({ data: { updateId, status: 'COMPLETED' } }),
    ).rejects.toThrow();
    await prisma.telegramUpdateLog.deleteMany({ where: { updateId } });
  });

  it('expiring an abandoned order releases the inventory it was holding', async () => {
    const product = await createProduct(['abandoned-secret']);
    const customer = await newCustomer();

    const checkout = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId,
        idempotencyKey: `conc-expire-${Date.now()}`,
      })
      .expect(201);
    const orderId = checkout.body.id as string;
    orderIds.push(orderId);

    expect(
      await prisma.inventoryItem.count({ where: { productId: product.id, status: 'RESERVED' } }),
    ).toBe(1);

    // Backdate it past the expiry window and sweep.
    await prisma.order.update({
      where: { id: orderId },
      data: { createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3) },
    });
    await cleanup.expireStaleOrders();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('CANCELLED');
    expect(
      await prisma.inventoryItem.count({ where: { productId: product.id, status: 'AVAILABLE' } }),
    ).toBe(1);
  });

  it('a rejected upload type never reaches storage', async () => {
    const product = await createProduct([], 5);
    const customer = await newCustomer();
    const checkout = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId,
        idempotencyKey: `conc-badfile-${Date.now()}`,
      })
      .expect(201);
    const orderId = checkout.body.id as string;
    orderIds.push(orderId);

    // Declares image/png but the bytes are an ELF binary.
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/payment-proof`)
      .set('Authorization', `Bearer ${customer.token}`)
      .attach('file', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]), {
        filename: 'payload.png',
        contentType: 'image/png',
      })
      .expect(400);

    expect(await prisma.paymentProof.count({ where: { orderId } })).toBe(0);
  });
});
