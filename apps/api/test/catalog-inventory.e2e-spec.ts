import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { InsufficientInventoryError } from '../src/modules/inventory/errors/insufficient-inventory.error';

describe('Catalog + Inventory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inventory: InventoryService;

  const adminEmail = `e2e-catalog-admin-${Date.now()}@sqlm.local`;
  const adminPassword = 'CatalogAdmin9!Pass';
  let adminId: string;
  let adminToken: string;

  const categoryIds: string[] = [];
  const productIds: string[] = [];
  const customerIds: string[] = [];
  const orderIds: string[] = [];

  async function createOrderFixture(customerId: string, idempotencyKey: string) {
    const order = await prisma.order.create({
      data: {
        customerId,
        status: 'PENDING_PAYMENT',
        currency: 'USD',
        subtotal: 10,
        total: 10,
        idempotencyKey,
      },
    });
    orderIds.push(order.id);
    return order.id;
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
        name: 'E2E Catalog Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    adminId = admin.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/staff/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    await prisma.inventoryItem.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.staff.deleteMany({ where: { id: adminId } });
    await app?.close();
  });

  describe('categories', () => {
    it('creates a category as admin and lists it publicly', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ slug: `e2e-cat-${Date.now()}`, name: 'E2E Category' })
        .expect(201);
      categoryIds.push(created.body.id);

      const publicList = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .expect(200);
      expect(publicList.body.find((c: { id: string }) => c.id === created.body.id)).toBeDefined();
    });

    it('rejects category creation without admin token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .send({ slug: 'no-auth', name: 'No Auth' })
        .expect(401);
    });

    it('rejects a duplicate slug', async () => {
      const slug = `e2e-dup-${Date.now()}`;
      const first = await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ slug, name: 'First' })
        .expect(201);
      categoryIds.push(first.body.id);

      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ slug, name: 'Second' })
        .expect(409);
    });
  });

  describe('products', () => {
    it('creates a DRAFT product that is invisible publicly, then ACTIVE+VISIBLE makes it appear', async () => {
      const slug = `e2e-product-${Date.now()}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug,
          name: 'E2E Draft Product',
          price: 9.99,
          inventoryMode: 'QUANTITY',
          deliveryType: 'MANUAL',
          fulfillmentType: 'MANUAL_SERVICE',
          stock: 5,
        })
        .expect(201);
      productIds.push(created.body.id);

      await request(app.getHttpServer()).get(`/api/v1/products/${slug}`).expect(404);

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/products/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE', visibility: 'VISIBLE' })
        .expect(200);

      const publicView = await request(app.getHttpServer())
        .get(`/api/v1/products/${slug}`)
        .expect(200);
      expect(publicView.body.availableStock).toBe(5);
    });

    it('denies product mutation for a role without products.write', async () => {
      const agent = await prisma.staff.create({
        data: {
          email: `e2e-catalog-agent-${Date.now()}@sqlm.local`,
          passwordHash: await argon2.hash('AgentPass9!'),
          name: 'E2E Support Agent',
          role: 'SUPPORT_AGENT',
          status: 'ACTIVE',
        },
      });
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: agent.email, password: 'AgentPass9!' });

      await request(app.getHttpServer())
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .send({
          slug: 'should-not-be-created',
          name: 'Nope',
          price: 1,
          inventoryMode: 'QUANTITY',
          deliveryType: 'MANUAL',
          fulfillmentType: 'MANUAL_SERVICE',
        })
        .expect(403);

      await prisma.staff.delete({ where: { id: agent.id } });
    });
  });

  describe('inventory', () => {
    it('bulk-imports individual items and never exposes the secret in list view', async () => {
      const product = await prisma.product.create({
        data: {
          slug: `e2e-individual-${Date.now()}`,
          name: 'E2E Individual Product',
          price: 19.99,
          inventoryMode: 'INDIVIDUAL',
          deliveryType: 'AUTOMATIC',
          fulfillmentType: 'ACCOUNT',
          status: 'ACTIVE',
          visibility: 'VISIBLE',
        },
      });
      productIds.push(product.id);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/inventory/products/${product.id}/import`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ secrets: ['user1@example.com:pass1', 'user2@example.com:pass2'] })
        .expect(201);

      const list = await request(app.getHttpServer())
        .get(`/api/v1/admin/inventory/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(list.body.total).toBe(2);
      expect(list.body.items[0].encryptedPayload).toBeUndefined();

      const revealed = await request(app.getHttpServer())
        .post(`/api/v1/admin/inventory/${list.body.items[0].id}/reveal`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(['user1@example.com:pass1', 'user2@example.com:pass2']).toContain(
        revealed.body.secret,
      );

      const auditEntry = await prisma.auditLog.findFirst({
        where: { entityId: list.body.items[0].id, action: 'inventory.reveal_secret' },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry?.actorStaffId).toBe(adminId);
    });

    it('does not oversell individual inventory under concurrent reservation', async () => {
      const product = await prisma.product.create({
        data: {
          slug: `e2e-concurrency-individual-${Date.now()}`,
          name: 'E2E Concurrency Individual',
          price: 5,
          inventoryMode: 'INDIVIDUAL',
          deliveryType: 'AUTOMATIC',
          fulfillmentType: 'ACCOUNT',
          status: 'ACTIVE',
          visibility: 'VISIBLE',
        },
      });
      productIds.push(product.id);

      const STOCK = 3;
      const ATTEMPTS = 8;
      await inventory.bulkImport(
        product.id,
        Array.from({ length: STOCK }, (_, i) => `secret-${i}`),
      );

      const customer = await prisma.customer.create({
        data: { telegramId: BigInt(Date.now()) },
      });
      customerIds.push(customer.id);

      const attemptOrderIds = await Promise.all(
        Array.from({ length: ATTEMPTS }, (_, i) =>
          createOrderFixture(customer.id, `concurrency-individual-${Date.now()}-${i}`),
        ),
      );

      const results = await Promise.allSettled(
        attemptOrderIds.map((orderId) =>
          prisma.$transaction((tx) => inventory.reserveIndividualItems(tx, product.id, 1, orderId)),
        ),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      expect(succeeded).toHaveLength(STOCK);
      expect(failed).toHaveLength(ATTEMPTS - STOCK);
      for (const failure of failed as PromiseRejectedResult[]) {
        expect(failure.reason).toBeInstanceOf(InsufficientInventoryError);
      }

      const remainingAvailable = await inventory.availableCount(product.id);
      expect(remainingAvailable).toBe(0);
      const reservedCount = await prisma.inventoryItem.count({
        where: { productId: product.id, status: 'RESERVED' },
      });
      expect(reservedCount).toBe(STOCK);
    });

    it('does not oversell QUANTITY-mode stock under concurrent reservation', async () => {
      const product = await prisma.product.create({
        data: {
          slug: `e2e-concurrency-quantity-${Date.now()}`,
          name: 'E2E Concurrency Quantity',
          price: 5,
          inventoryMode: 'QUANTITY',
          deliveryType: 'MANUAL',
          fulfillmentType: 'MANUAL_SERVICE',
          status: 'ACTIVE',
          visibility: 'VISIBLE',
          stock: 3,
        },
      });
      productIds.push(product.id);

      const ATTEMPTS = 8;
      const results = await Promise.allSettled(
        Array.from({ length: ATTEMPTS }, () =>
          prisma.$transaction((tx) => inventory.reserveQuantity(tx, product.id, 1)),
        ),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded).toHaveLength(3);

      const finalProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(finalProduct.stock).toBe(0);
    });
  });
});
