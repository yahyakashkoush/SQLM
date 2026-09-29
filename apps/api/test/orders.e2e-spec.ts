import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';

describe('Orders + Checkout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inventory: InventoryService;

  const adminEmail = `e2e-orders-admin-${Date.now()}@sqlm.local`;
  const adminPassword = 'OrdersAdmin9!Pass';
  let adminId: string;
  let adminToken: string;

  const productIds: string[] = [];
  const customerTokens = new Map<string, string>();
  const customerIds: string[] = [];
  const orderIds: string[] = [];
  let paymentMethodId: string;
  let disabledPaymentMethodId: string;

  async function authenticateCustomer(telegramId: number): Promise<{ id: string; token: string }> {
    const customer = await prisma.customer.create({ data: { telegramId: BigInt(telegramId) } });
    customerIds.push(customer.id);
    // Issue a token directly rather than re-deriving the Telegram HMAC signing
    // helper here — auth.e2e-spec.ts already covers that path end to end.
    const jwt = app.get(JwtService);
    const config = app.get(ConfigService);
    const token = jwt.sign(
      { sub: customer.id, type: 'customer' },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '1h' },
    );
    customerTokens.set(customer.id, token);
    return { id: customer.id, token };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    inventory = app.get(InventoryService);

    const admin = await prisma.staff.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash(adminPassword),
        name: 'E2E Orders Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    adminId = admin.id;
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/staff/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = login.body.accessToken;

    const paymentMethod = await prisma.paymentMethod.create({
      data: { name: 'E2E Bank Transfer', enabled: true, currency: 'USD' },
    });
    paymentMethodId = paymentMethod.id;
    const disabled = await prisma.paymentMethod.create({
      data: { name: 'E2E Disabled Method', enabled: false, currency: 'USD' },
    });
    disabledPaymentMethodId = disabled.id;
  });

  afterAll(async () => {
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.inventoryItem.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.paymentMethod.deleteMany({ where: { id: { in: [paymentMethodId, disabledPaymentMethodId] } } });
    await prisma.staff.deleteMany({ where: { id: adminId } });
    await app?.close();
  });

  async function createIndividualProduct(secretCount: number) {
    const product = await prisma.product.create({
      data: {
        slug: `e2e-order-individual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: 'E2E Order Individual Product',
        price: 25,
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'AUTOMATIC',
        fulfillmentType: 'ACCOUNT',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
      },
    });
    productIds.push(product.id);
    if (secretCount > 0) {
      await inventory.bulkImport(
        product.id,
        Array.from({ length: secretCount }, (_, i) => `order-secret-${product.id}-${i}`),
      );
    }
    return product;
  }

  async function createQuantityProduct(stock: number) {
    const product = await prisma.product.create({
      data: {
        slug: `e2e-order-quantity-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: 'E2E Order Quantity Product',
        price: 10,
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        fulfillmentType: 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock,
      },
    });
    productIds.push(product.id);
    return product;
  }

  describe('checkout', () => {
    it('creates an order in PENDING_PAYMENT, computes totals server-side, and reserves inventory', async () => {
      const product = await createIndividualProduct(2);
      const { token } = await authenticateCustomer(Date.now() + 1);

      const res = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethodId,
          idempotencyKey: `checkout-${Date.now()}-1`,
        })
        .expect(201);
      orderIds.push(res.body.id);

      expect(res.body.status).toBe('PENDING_PAYMENT');
      expect(res.body.subtotal).toBe('25');
      expect(res.body.total).toBe('25');
      expect(res.body.items).toHaveLength(1);

      const available = await inventory.availableCount(product.id);
      expect(available).toBe(1);
      const reserved = await prisma.inventoryItem.count({
        where: { productId: product.id, status: 'RESERVED', orderId: res.body.id },
      });
      expect(reserved).toBe(1);
    });

    it('is idempotent: retrying with the same idempotencyKey returns the same order, no double reservation', async () => {
      const product = await createIndividualProduct(3);
      const { id: customerId, token } = await authenticateCustomer(Date.now() + 2);
      const idempotencyKey = `checkout-idempotent-${Date.now()}`;
      const payload = {
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId,
        idempotencyKey,
      };

      const first = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);
      orderIds.push(first.body.id);

      const second = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      expect(second.body.id).toBe(first.body.id);

      const orderCount = await prisma.order.count({ where: { customerId, idempotencyKey } });
      expect(orderCount).toBe(1);
      const reservedCount = await prisma.inventoryItem.count({
        where: { productId: product.id, status: 'RESERVED' },
      });
      expect(reservedCount).toBe(1);
    });

    it('handles a true concurrent double-tap on the same idempotency key without creating two orders', async () => {
      const product = await createIndividualProduct(3);
      const { token } = await authenticateCustomer(Date.now() + 3);
      const idempotencyKey = `checkout-concurrent-${Date.now()}`;
      const payload = {
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId,
        idempotencyKey,
      };

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/orders/checkout')
          .set('Authorization', `Bearer ${token}`)
          .send(payload),
        request(app.getHttpServer())
          .post('/api/v1/orders/checkout')
          .set('Authorization', `Bearer ${token}`)
          .send(payload),
      ]);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);
      orderIds.push(a.body.id);

      const reservedCount = await prisma.inventoryItem.count({
        where: { productId: product.id, status: 'RESERVED' },
      });
      expect(reservedCount).toBe(1);
    });

    it('rejects checkout when inventory is insufficient and leaves nothing reserved', async () => {
      const product = await createIndividualProduct(1);
      const { token } = await authenticateCustomer(Date.now() + 4);

      await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{ productId: product.id, quantity: 5 }],
          paymentMethodId,
          idempotencyKey: `checkout-insufficient-${Date.now()}`,
        })
        .expect(409);

      const available = await inventory.availableCount(product.id);
      expect(available).toBe(1);
      const reservedCount = await prisma.inventoryItem.count({
        where: { productId: product.id, status: 'RESERVED' },
      });
      expect(reservedCount).toBe(0);
    });

    it('rejects checkout with a disabled payment method', async () => {
      const product = await createIndividualProduct(1);
      const { token } = await authenticateCustomer(Date.now() + 5);

      await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethodId: disabledPaymentMethodId,
          idempotencyKey: `checkout-disabled-pm-${Date.now()}`,
        })
        .expect(400);
    });

    it('rejects checkout for a DRAFT (non-purchasable) product', async () => {
      const draft = await prisma.product.create({
        data: {
          slug: `e2e-order-draft-${Date.now()}`,
          name: 'E2E Draft',
          price: 5,
          inventoryMode: 'QUANTITY',
          deliveryType: 'MANUAL',
          fulfillmentType: 'MANUAL_SERVICE',
          status: 'DRAFT',
          stock: 10,
        },
      });
      productIds.push(draft.id);
      const { token } = await authenticateCustomer(Date.now() + 6);

      await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{ productId: draft.id, quantity: 1 }],
          paymentMethodId,
          idempotencyKey: `checkout-draft-${Date.now()}`,
        })
        .expect(409);
    });

    it('a customer cannot see another customer\'s order', async () => {
      const product = await createQuantityProduct(5);
      const { token: ownerToken } = await authenticateCustomer(Date.now() + 7);
      const { token: strangerToken } = await authenticateCustomer(Date.now() + 8);

      const created = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethodId,
          idempotencyKey: `checkout-ownership-${Date.now()}`,
        })
        .expect(201);
      orderIds.push(created.body.id);

      await request(app.getHttpServer())
        .get(`/api/v1/orders/${created.body.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/v1/orders/${created.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  describe('order state machine', () => {
    it('walks an order through the full happy path and records an audit trail', async () => {
      const product = await createQuantityProduct(5);
      const { token } = await authenticateCustomer(Date.now() + 9);

      const created = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethodId,
          idempotencyKey: `checkout-happy-path-${Date.now()}`,
        })
        .expect(201);
      const orderId = created.body.id;
      orderIds.push(orderId);

      const path: Array<[string, string?]> = [
        ['PAYMENT_SUBMITTED'],
        ['PAYMENT_REVIEW'],
        ['PAID'],
        ['PROCESSING'],
        ['READY_FOR_DELIVERY'],
        ['DELIVERED'],
        ['COMPLETED'],
      ];
      // Since Phase 9, reaching PAID hands the order to fulfillment, which
      // advances PROCESSING -> READY_FOR_DELIVERY (and DELIVERED when every
      // item is automatic) on its own. So each step is applied only if the
      // order is not already at or past it — a 409 here would mean the
      // system already did that step, which is not a failure.
      for (const [toStatus] of path) {
        const current = await request(app.getHttpServer())
          .get(`/api/v1/admin/orders/${orderId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        if (current.body.status === toStatus) continue;

        const res = await request(app.getHttpServer())
          .post(`/api/v1/admin/orders/${orderId}/transition`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ toStatus });
        expect([201, 409]).toContain(res.status);
      }

      const final = await request(app.getHttpServer())
        .get(`/api/v1/admin/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(final.body.status).toBe('COMPLETED');

      const events = await prisma.orderEvent.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      // INVENTORY_RESERVED + (CREATED->PENDING_PAYMENT) + 7 staff transitions
      expect(events.length).toBeGreaterThanOrEqual(9);
      expect(events.some((e) => e.toStatus === 'COMPLETED' && e.actorStaffId === adminId)).toBe(
        true,
      );
    });

    it('rejects an invalid transition (skipping states)', async () => {
      const product = await createQuantityProduct(5);
      const { token } = await authenticateCustomer(Date.now() + 10);

      const created = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethodId,
          idempotencyKey: `checkout-invalid-transition-${Date.now()}`,
        })
        .expect(201);
      orderIds.push(created.body.id);

      // PENDING_PAYMENT -> DELIVERED is not a legal transition.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${created.body.id}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toStatus: 'DELIVERED' })
        .expect(409);
    });

    it('releases reserved individual inventory back to AVAILABLE on cancellation', async () => {
      const product = await createIndividualProduct(1);
      const { token } = await authenticateCustomer(Date.now() + 11);

      const created = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethodId,
          idempotencyKey: `checkout-cancel-individual-${Date.now()}`,
        })
        .expect(201);
      orderIds.push(created.body.id);
      expect(await inventory.availableCount(product.id)).toBe(0);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${created.body.id}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toStatus: 'CANCELLED', note: 'customer requested cancellation' })
        .expect(201);

      expect(await inventory.availableCount(product.id)).toBe(1);
      const item = await prisma.inventoryItem.findFirst({ where: { productId: product.id } });
      expect(item?.status).toBe('AVAILABLE');
      expect(item?.orderId).toBeNull();
    });

    it('releases reserved QUANTITY-mode stock back on cancellation', async () => {
      const product = await createQuantityProduct(3);
      const { token } = await authenticateCustomer(Date.now() + 12);

      const created = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [{ productId: product.id, quantity: 2 }],
          paymentMethodId,
          idempotencyKey: `checkout-cancel-quantity-${Date.now()}`,
        })
        .expect(201);
      orderIds.push(created.body.id);

      let current = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(current.stock).toBe(1);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${created.body.id}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toStatus: 'CANCELLED' })
        .expect(201);

      current = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(current.stock).toBe(3);
    });
  });
});
