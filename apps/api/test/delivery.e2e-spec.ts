import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { encryptSecret } from '@sqlm/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { DeliveryService } from '../src/modules/delivery/delivery.service';
import { OrdersService } from '../src/modules/orders/orders.service';

/**
 * The single most important property in this suite: an inventory item is
 * never handed to a customer twice, no matter how many times fulfillment
 * runs or how many workers run it at once.
 */
describe('Delivery / fulfillment (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let delivery: DeliveryService;

  const agentEmail = `e2e-delivery-agent-${Date.now()}@sqlm.local`;
  const agentPassword = 'DeliveryAgent9!Pass';
  let agentId: string;
  let agentToken: string;
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

  async function createProduct(opts: {
    inventoryMode: 'INDIVIDUAL' | 'QUANTITY';
    deliveryType: 'AUTOMATIC' | 'MANUAL' | 'ACCOUNT';
    secrets?: string[];
    stock?: number;
  }) {
    const product = await prisma.product.create({
      data: {
        slug: `e2e-delivery-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: 'E2E Delivery Product',
        price: 25,
        inventoryMode: opts.inventoryMode,
        deliveryType: opts.deliveryType,
        fulfillmentType: opts.inventoryMode === 'INDIVIDUAL' ? 'ACCOUNT' : 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock: opts.stock ?? 0,
      },
    });
    productIds.push(product.id);

    if (opts.secrets?.length) {
      const key = config.getOrThrow<string>('INVENTORY_ENCRYPTION_KEY');
      await prisma.inventoryItem.createMany({
        data: opts.secrets.map((s) => ({
          productId: product.id,
          encryptedPayload: encryptSecret(s, key),
        })),
      });
    }
    return product;
  }

  /** Checkout + approve payment through the real endpoints, leaving the order PAID. */
  async function createPaidOrder(items: Array<{ productId: string; quantity: number }>) {
    const customer = await prisma.customer.create({
      data: { telegramId: BigInt(Date.now() + Math.floor(Math.random() * 100000)) },
    });
    customerIds.push(customer.id);
    const token = customerToken(customer.id);

    const checkout = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items,
        paymentMethodId,
        idempotencyKey: `delivery-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
      .expect(201);

    const orderId = checkout.body.id as string;
    orderIds.push(orderId);

    // Straight to PAID via the state machine (the payment-proof path is
    // covered in payments.e2e-spec.ts; this suite is about what happens next).
    const orders = app.get(OrdersService);
    await prisma.$transaction(async (tx) => {
      await orders.transition(tx, orderId, 'PAYMENT_SUBMITTED', { type: 'SYSTEM' });
      await orders.transition(tx, orderId, 'PAYMENT_REVIEW', { type: 'SYSTEM' });
      await orders.transition(tx, orderId, 'PAID', { type: 'SYSTEM' });
    });

    return { customerId: customer.id, token, orderId };
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
    delivery = app.get(DeliveryService);

    const agent = await prisma.staff.create({
      data: {
        email: agentEmail,
        passwordHash: await argon2.hash(agentPassword),
        name: 'E2E Delivery Agent',
        role: 'DELIVERY_AGENT',
        status: 'ACTIVE',
      },
    });
    agentId = agent.id;
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/staff/login')
      .send({ email: agentEmail, password: agentPassword });
    agentToken = login.body.accessToken;

    const method = await prisma.paymentMethod.create({
      data: { name: 'E2E Delivery Payment Method', enabled: true, currency: 'USD' },
    });
    paymentMethodId = method.id;
  });

  afterAll(async () => {
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.inventoryItem.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.paymentMethod.deleteMany({ where: { id: paymentMethodId } });
    await prisma.staff.deleteMany({ where: { id: agentId } });
    await app?.close();
  });

  describe('method resolution', () => {
    it('only treats a product as auto-deliverable when a stored secret backs it', () => {
      expect(DeliveryService.resolveMethod('AUTOMATIC', 'INDIVIDUAL')).toBe('AUTOMATIC');
      expect(DeliveryService.resolveMethod('ACCOUNT', 'INDIVIDUAL')).toBe('AUTOMATIC');
      expect(DeliveryService.resolveMethod('MANUAL', 'INDIVIDUAL')).toBe('MANUAL');
      expect(DeliveryService.resolveMethod('CUSTOM', 'INDIVIDUAL')).toBe('MANUAL');
      // Configured automatic but nothing stored to hand over.
      expect(DeliveryService.resolveMethod('AUTOMATIC', 'QUANTITY')).toBe('MANUAL');
    });
  });

  describe('automatic fulfillment', () => {
    it('delivers the order’s own reserved secrets and completes the order', async () => {
      const product = await createProduct({
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'AUTOMATIC',
        secrets: ['auto-secret-alpha'],
      });
      const { orderId, token } = await createPaidOrder([{ productId: product.id, quantity: 1 }]);

      const result = await delivery.fulfillOrder(orderId);
      expect(result.delivered).toBe(1);
      expect(result.manual).toBe(0);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('DELIVERED');
      expect(order.deliveredAt).not.toBeNull();

      const items = await prisma.inventoryItem.findMany({ where: { productId: product.id } });
      expect(items.every((i) => i.status === 'DELIVERED')).toBe(true);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}/deliveries`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].content).toBe('auto-secret-alpha');
      expect(res.body[0].status).toBe('DELIVERED');
    });

    it('stores delivered content encrypted at rest, never plaintext', async () => {
      const product = await createProduct({
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'ACCOUNT',
        secrets: ['super-secret-password-xyz'],
      });
      const { orderId } = await createPaidOrder([{ productId: product.id, quantity: 1 }]);
      await delivery.fulfillOrder(orderId);

      const row = await prisma.delivery.findFirstOrThrow({ where: { orderId } });
      expect(row.encryptedContent).not.toBeNull();
      expect(row.encryptedContent).not.toContain('super-secret-password-xyz');
    });

    it('hands over every unit when quantity > 1', async () => {
      const product = await createProduct({
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'AUTOMATIC',
        secrets: ['multi-1', 'multi-2', 'multi-3'],
      });
      const { orderId, token } = await createPaidOrder([{ productId: product.id, quantity: 2 }]);
      await delivery.fulfillOrder(orderId);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}/deliveries`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const lines = (res.body[0].content as string).split('\n');
      expect(lines).toHaveLength(2);

      const delivered = await prisma.inventoryItem.count({
        where: { productId: product.id, status: 'DELIVERED' },
      });
      expect(delivered).toBe(2);
      // The third item was never part of this order and stays untouched.
      const available = await prisma.inventoryItem.count({
        where: { productId: product.id, status: 'AVAILABLE' },
      });
      expect(available).toBe(1);
    });
  });

  describe('duplicate-delivery protection', () => {
    it('re-running fulfillment for the same order delivers nothing extra', async () => {
      const product = await createProduct({
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'AUTOMATIC',
        secrets: ['idempotent-secret'],
      });
      const { orderId } = await createPaidOrder([{ productId: product.id, quantity: 1 }]);

      await delivery.fulfillOrder(orderId);
      const second = await delivery.fulfillOrder(orderId);
      const third = await delivery.fulfillOrder(orderId);

      expect(second.delivered + second.manual).toBe(0);
      expect(third.delivered + third.manual).toBe(0);

      const rows = await prisma.delivery.findMany({ where: { orderId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.attempts).toBe(1);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('DELIVERED');
    });

    it('two workers fulfilling the same order concurrently deliver each item exactly once', async () => {
      const product = await createProduct({
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'AUTOMATIC',
        secrets: ['race-secret-1', 'race-secret-2'],
      });
      const { orderId } = await createPaidOrder([{ productId: product.id, quantity: 2 }]);

      const results = await Promise.allSettled([
        delivery.fulfillOrder(orderId),
        delivery.fulfillOrder(orderId),
        delivery.fulfillOrder(orderId),
      ]);
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

      // The invariant that matters: one delivery row, two inventory items
      // delivered, nothing double-issued.
      const rows = await prisma.delivery.findMany({ where: { orderId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('DELIVERED');

      const delivered = await prisma.inventoryItem.count({
        where: { productId: product.id, status: 'DELIVERED' },
      });
      expect(delivered).toBe(2);

      const stillSold = await prisma.inventoryItem.count({
        where: { productId: product.id, status: 'SOLD' },
      });
      expect(stillSold).toBe(0);
    });

    it('never delivers an inventory item that belongs to another order', async () => {
      const product = await createProduct({
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'AUTOMATIC',
        secrets: ['order-a-secret', 'order-b-secret'],
      });
      const a = await createPaidOrder([{ productId: product.id, quantity: 1 }]);
      const b = await createPaidOrder([{ productId: product.id, quantity: 1 }]);

      await Promise.all([delivery.fulfillOrder(a.orderId), delivery.fulfillOrder(b.orderId)]);

      const rowA = await prisma.delivery.findFirstOrThrow({ where: { orderId: a.orderId } });
      const rowB = await prisma.delivery.findFirstOrThrow({ where: { orderId: b.orderId } });

      expect(rowA.inventoryItemIds).toHaveLength(1);
      expect(rowB.inventoryItemIds).toHaveLength(1);
      // Disjoint sets — the whole point.
      expect(rowA.inventoryItemIds[0]).not.toBe(rowB.inventoryItemIds[0]);

      const allDelivered = await prisma.inventoryItem.count({
        where: { productId: product.id, status: 'DELIVERED' },
      });
      expect(allDelivered).toBe(2);
    });
  });

  describe('manual fulfillment', () => {
    it('parks a manual product at READY_FOR_DELIVERY and completes on agent action', async () => {
      const product = await createProduct({
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        stock: 5,
      });
      const { orderId, token } = await createPaidOrder([{ productId: product.id, quantity: 1 }]);

      const result = await delivery.fulfillOrder(orderId);
      expect(result.manual).toBe(1);
      expect(result.delivered).toBe(0);

      let order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('READY_FOR_DELIVERY');

      const pending = await request(app.getHttpServer())
        .get('/api/v1/admin/deliveries/pending')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(200);
      const mine = (pending.body as Array<{ id: string; orderId: string }>).find(
        (d) => d.orderId === orderId,
      );
      expect(mine).toBeDefined();

      await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${mine!.id}/fulfill`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ content: 'activated-account-manual', note: 'Activated by agent' })
        .expect(201);

      order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('DELIVERED');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}/deliveries`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body[0].content).toBe('activated-account-manual');
      expect(res.body[0].method).toBe('MANUAL');
    });

    it('rejects a second manual fulfillment of the same delivery', async () => {
      const product = await createProduct({
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        stock: 5,
      });
      const { orderId } = await createPaidOrder([{ productId: product.id, quantity: 1 }]);
      await delivery.fulfillOrder(orderId);

      const row = await prisma.delivery.findFirstOrThrow({ where: { orderId } });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${row.id}/fulfill`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ content: 'first-delivery' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${row.id}/fulfill`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ content: 'second-delivery-attempt' })
        .expect(409);

      const after = await prisma.delivery.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.note).toBeNull();
    });

    it('a mixed order only reaches DELIVERED once the manual item is handled too', async () => {
      const autoProduct = await createProduct({
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'AUTOMATIC',
        secrets: ['mixed-auto-secret'],
      });
      const manualProduct = await createProduct({
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        stock: 3,
      });
      const { orderId } = await createPaidOrder([
        { productId: autoProduct.id, quantity: 1 },
        { productId: manualProduct.id, quantity: 1 },
      ]);

      const result = await delivery.fulfillOrder(orderId);
      expect(result.delivered).toBe(1);
      expect(result.manual).toBe(1);

      let order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('READY_FOR_DELIVERY');

      const manualRow = await prisma.delivery.findFirstOrThrow({
        where: { orderId, method: 'MANUAL' },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${manualRow.id}/fulfill`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ content: 'mixed-manual-content' })
        .expect(201);

      order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('DELIVERED');
    });
  });

  describe('access control', () => {
    it('a customer cannot read another customer’s delivered secrets', async () => {
      const product = await createProduct({
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'AUTOMATIC',
        secrets: ['private-to-owner'],
      });
      const owner = await createPaidOrder([{ productId: product.id, quantity: 1 }]);
      await delivery.fulfillOrder(owner.orderId);

      const intruder = await prisma.customer.create({
        data: { telegramId: BigInt(Date.now() + 987654) },
      });
      customerIds.push(intruder.id);

      await request(app.getHttpServer())
        .get(`/api/v1/orders/${owner.orderId}/deliveries`)
        .set('Authorization', `Bearer ${customerToken(intruder.id)}`)
        .expect(404);
    });

    it('requires delivery.fulfill for manual fulfillment', async () => {
      const product = await createProduct({
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        stock: 2,
      });
      const { orderId, token } = await createPaidOrder([{ productId: product.id, quantity: 1 }]);
      await delivery.fulfillOrder(orderId);
      const row = await prisma.delivery.findFirstOrThrow({ where: { orderId } });

      // A customer token is not a staff token.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${row.id}/fulfill`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'nope' })
        .expect(401);
    });
  });

  describe('failure handling', () => {
    it('falls back to manual when the expected sold inventory is missing', async () => {
      const product = await createProduct({
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'AUTOMATIC',
        secrets: ['will-be-removed'],
      });
      const { orderId } = await createPaidOrder([{ productId: product.id, quantity: 1 }]);

      // Simulate the item being pulled out from under fulfillment (disabled
      // by an admin after the sale, data repair, ...).
      await prisma.inventoryItem.updateMany({
        where: { orderId },
        data: { status: 'DISABLED', orderId: null },
      });

      const result = await delivery.fulfillOrder(orderId);
      expect(result.delivered).toBe(0);
      expect(result.manual).toBe(1);

      const row = await prisma.delivery.findFirstOrThrow({ where: { orderId } });
      expect(row.method).toBe('MANUAL');
      expect(row.status).toBe('PENDING');
      expect(row.lastError).toContain('found 0');

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('READY_FOR_DELIVERY');
    });
  });
});
