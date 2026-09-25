import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';

describe('Payments + Payment Proofs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;

  const adminEmail = `e2e-payments-admin-${Date.now()}@sqlm.local`;
  const adminPassword = 'PaymentsAdmin9!Pass';
  let adminId: string;
  let adminToken: string;
  let secondAdminId: string;
  let secondAdminToken: string;

  const productIds: string[] = [];
  const customerIds: string[] = [];
  const orderIds: string[] = [];
  const paymentMethodIds: string[] = [];

  function customerToken(customerId: string): string {
    return jwt.sign(
      { sub: customerId, type: 'customer' },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '1h' },
    );
  }

  async function createCustomerWithOrder(telegramId: number, price = 10) {
    const customer = await prisma.customer.create({ data: { telegramId: BigInt(telegramId) } });
    customerIds.push(customer.id);
    const product = await prisma.product.create({
      data: {
        slug: `e2e-payment-product-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: 'E2E Payment Product',
        price,
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        fulfillmentType: 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock: 10,
      },
    });
    productIds.push(product.id);
    const token = customerToken(customer.id);

    const order = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId: paymentMethodIds[0],
        idempotencyKey: `payments-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
      .expect(201);
    orderIds.push(order.body.id);

    return { customerId: customer.id, token, orderId: order.body.id as string, productId: product.id };
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

    const admin = await prisma.staff.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash(adminPassword),
        name: 'E2E Payments Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    adminId = admin.id;
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/staff/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = login.body.accessToken;

    const secondAdmin = await prisma.staff.create({
      data: {
        email: `e2e-payments-admin2-${Date.now()}@sqlm.local`,
        passwordHash: await argon2.hash(adminPassword),
        name: 'E2E Payments Admin Two',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    secondAdminId = secondAdmin.id;
    const login2 = await request(app.getHttpServer())
      .post('/api/v1/auth/staff/login')
      .send({ email: secondAdmin.email, password: adminPassword });
    secondAdminToken = login2.body.accessToken;

    const method = await prisma.paymentMethod.create({
      data: { name: 'E2E Payments Bank Transfer', enabled: true, currency: 'USD' },
    });
    paymentMethodIds.push(method.id);
  });

  afterAll(async () => {
    await prisma.paymentProof.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.paymentMethod.deleteMany({ where: { id: { in: paymentMethodIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: [adminId, secondAdminId] } } });
    await app?.close();
  });

  describe('payment methods', () => {
    it('public listing only shows enabled methods', async () => {
      const disabled = await prisma.paymentMethod.create({
        data: { name: 'E2E Disabled For Listing Test', enabled: false, currency: 'USD' },
      });
      paymentMethodIds.push(disabled.id);

      const res = await request(app.getHttpServer()).get('/api/v1/payment-methods').expect(200);
      expect(res.body.some((m: { id: string }) => m.id === paymentMethodIds[0])).toBe(true);
      expect(res.body.some((m: { id: string }) => m.id === disabled.id)).toBe(false);
    });
  });

  describe('payment proof upload', () => {
    it('uploads a proof, moves the order to PAYMENT_REVIEW, and rejects a second upload as a duplicate', async () => {
      const { token, orderId } = await createCustomerWithOrder(Date.now() + 100);

      const uploadRes = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/payment-proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('fake-image-bytes'), {
          filename: 'receipt.png',
          contentType: 'image/png',
        })
        .expect(201);
      expect(uploadRes.body.status).toBe('PENDING');

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('PAYMENT_REVIEW');

      // Duplicate submission: order is no longer PENDING_PAYMENT, so this must be rejected,
      // not silently create a second PaymentProof row.
      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/payment-proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('fake-image-bytes-2'), {
          filename: 'receipt2.png',
          contentType: 'image/png',
        })
        .expect(409);

      const proofCount = await prisma.paymentProof.count({ where: { orderId } });
      expect(proofCount).toBe(1);
    });

    it('rejects an unsupported file type', async () => {
      const { token, orderId } = await createCustomerWithOrder(Date.now() + 101);

      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/payment-proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('not-a-real-executable'), {
          filename: 'malware.exe',
          contentType: 'application/x-msdownload',
        })
        .expect(400);
    });
  });

  describe('admin review', () => {
    it('approve transitions the order to PAID', async () => {
      const { token, orderId } = await createCustomerWithOrder(Date.now() + 102);
      const upload = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/payment-proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('receipt'), { filename: 'r.png', contentType: 'image/png' });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/payment-proofs/${upload.body.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('PAID');
      expect(order.paidAt).not.toBeNull();
    });

    it('two admins racing to approve the same proof: exactly one succeeds', async () => {
      const { token, orderId } = await createCustomerWithOrder(Date.now() + 103);
      const upload = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/payment-proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('receipt'), { filename: 'r.png', contentType: 'image/png' });

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/admin/payment-proofs/${upload.body.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`),
        request(app.getHttpServer())
          .post(`/api/v1/admin/payment-proofs/${upload.body.id}/approve`)
          .set('Authorization', `Bearer ${secondAdminToken}`),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('PAID');
      const events = await prisma.orderEvent.count({
        where: { orderId, type: 'PAYMENT_APPROVED' },
      });
      expect(events).toBe(1);
    });

    it('reject with cancelOrder=false returns the order to PENDING_PAYMENT for resubmission', async () => {
      const { token, orderId } = await createCustomerWithOrder(Date.now() + 104);
      const upload = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/payment-proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('receipt'), { filename: 'r.png', contentType: 'image/png' });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/payment-proofs/${upload.body.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Amount does not match', cancelOrder: false })
        .expect(201);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('PENDING_PAYMENT');

      // Customer can now resubmit a new proof.
      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/payment-proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('receipt-2'), { filename: 'r2.png', contentType: 'image/png' })
        .expect(201);
    });

    it('reject with cancelOrder=true cancels the order and releases inventory', async () => {
      const { token, orderId, productId } = await createCustomerWithOrder(Date.now() + 105);
      // Captured after checkout already reserved 1 unit, so this is stock - 1 vs the product's original 10.
      const productAfterCheckout = await prisma.product.findUniqueOrThrow({ where: { id: productId } });

      const upload = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/payment-proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('receipt'), { filename: 'r.png', contentType: 'image/png' });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/payment-proofs/${upload.body.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Fraudulent proof', cancelOrder: true })
        .expect(201);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('CANCELLED');
      const productAfterCancel = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
      // Cancellation releases the reserved unit back, restoring pre-checkout stock.
      expect(productAfterCancel.stock).toBe(productAfterCheckout.stock + 1);
    });

    it('returns a presigned view URL for a proof', async () => {
      const { token, orderId } = await createCustomerWithOrder(Date.now() + 106);
      const upload = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/payment-proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('receipt'), { filename: 'r.png', contentType: 'image/png' });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/payment-proofs/${upload.body.id}/view-url`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.url).toMatch(/^http/);
    });
  });
});
