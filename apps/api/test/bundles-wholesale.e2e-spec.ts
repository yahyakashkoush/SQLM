import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { E2E_CONTACT } from './fixtures';

/**
 * Quantity bundles, wholesale membership, first-order contact details and
 * the public website feed. Every price here comes from the database: the
 * client names a bundle, never what it costs.
 */
describe('Bundles, wholesale and first-order contact (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;

  const customerIds: string[] = [];
  const productIds: string[] = [];
  const staffIds: string[] = [];
  let methodId: string;
  let ownerToken: string;
  let supportToken: string;

  const token = (sub: string, type: 'customer' | 'staff') =>
    jwt.sign({ sub, type }, { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '1h' });

  async function newCustomer(data: { fullName?: string | null; contactPhone?: string | null } = E2E_CONTACT) {
    const customer = await prisma.customer.create({
      data: { telegramId: BigInt(Date.now() * 1000 + Math.floor(Math.random() * 1000)), ...data },
    });
    customerIds.push(customer.id);
    return { id: customer.id, token: token(customer.id, 'customer') };
  }

  async function newStaff(role: 'OWNER' | 'SUPPORT_AGENT') {
    const staff = await prisma.staff.create({
      data: {
        email: `bundle-e2e-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@sqlm.local`,
        passwordHash: 'x',
        name: `Bundle ${role}`,
        role,
        status: 'ACTIVE',
      },
    });
    staffIds.push(staff.id);
    return token(staff.id, 'staff');
  }

  const checkout = (customerToken: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ paymentMethodId: methodId, idempotencyKey: `bundle-e2e-${Date.now()}-${Math.random()}`, ...body });

  async function productWithBundles() {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Bundle E2E ${Date.now()}`,
        price: 3,
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        fulfillmentType: 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock: 100,
        costPrice: 1,
        ratingScore: 4.8,
        reviewCount: 1200,
        bundles: [
          { label: 'باقة 5', quantity: 5, price: 12.99 },
          { label: 'جملة 20', quantity: 20, price: 40, wholesaleOnly: true },
        ],
      })
      .expect(201);
    productIds.push(res.body.id);
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/products/${res.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const bundles = detail.body.bundles as Array<{ id: string; quantity: number; wholesaleOnly: boolean }>;
    return {
      id: res.body.id as string,
      slug: res.body.slug as string,
      retail: bundles.find((b) => !b.wholesaleOnly)!,
      wholesale: bundles.find((b) => b.wholesaleOnly)!,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    ownerToken = await newStaff('OWNER');
    supportToken = await newStaff('SUPPORT_AGENT');
    methodId = (
      await prisma.paymentMethod.create({
        data: { name: 'Bundle E2E USD', currency: 'USD', enabled: true, provider: 'MANUAL' },
      })
    ).id;
  });

  afterAll(async () => {
    const orders = await prisma.order.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.paymentMethod.deleteMany({ where: { id: methodId } });
    await prisma.auditLog.deleteMany({ where: { actorStaffId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('shows retail bundles and admin-set stars publicly, never wholesale bundles or the cost price', async () => {
    const product = await productWithBundles();
    const res = await request(app.getHttpServer()).get(`/api/v1/products/${product.slug}`).expect(200);
    expect(res.body.bundles).toHaveLength(1);
    expect(res.body.bundles[0]).toMatchObject({ quantity: 5, price: '12.99', label: 'باقة 5' });
    expect(res.body.costPrice).toBeNull();
    expect(Number(res.body.ratingScore)).toBe(4.8);
    expect(res.body.reviewCount).toBe(1200);
    expect(res.body.availableStock).toBe(100);
  });

  it('charges the bundle price from the database and reserves every unit', async () => {
    const product = await productWithBundles();
    const customer = await newCustomer();
    const res = await checkout(customer.token, {
      items: [{ productId: product.id, quantity: 2, bundleId: product.retail.id }],
    }).expect(201);
    expect(res.body.total).toBe('25.98');
    expect(res.body.items[0]).toMatchObject({ quantity: 10, lineTotal: '25.98', bundleLabel: 'باقة 5' });
    const stock = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stock.stock).toBe(90);
  });

  it('refuses a bundle that belongs to another product', async () => {
    const a = await productWithBundles();
    const b = await productWithBundles();
    const customer = await newCustomer();
    await checkout(customer.token, { items: [{ productId: a.id, quantity: 1, bundleId: b.retail.id }] }).expect(409);
  });

  it('keeps wholesale bundles for approved members only', async () => {
    const product = await productWithBundles();
    const customer = await newCustomer();
    await checkout(customer.token, {
      items: [{ productId: product.id, quantity: 1, bundleId: product.wholesale.id }],
    }).expect(409);
    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/wholesale/products/${product.id}/bundles`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(hidden.body).toEqual([]);

    await request(app.getHttpServer())
      .post('/api/v1/wholesale/apply')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ businessName: 'متجر التجربة', contactPhone: '01012345678', acceptTerms: false })
      .expect(400);
    const applied = await request(app.getHttpServer())
      .post('/api/v1/wholesale/apply')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ businessName: 'متجر التجربة', contactPhone: '01012345678', monthlyVolume: '100', acceptTerms: true })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/wholesale/apply')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ businessName: 'تاني', contactPhone: '01012345678', acceptTerms: true })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/wholesale/${applied.body.id}/review`)
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ approve: true })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/wholesale/${applied.body.id}/review`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ approve: true })
      .expect(201);

    const visible = await request(app.getHttpServer())
      .get(`/api/v1/wholesale/products/${product.id}/bundles`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(visible.body).toHaveLength(1);
    const order = await checkout(customer.token, {
      items: [{ productId: product.id, quantity: 1, bundleId: product.wholesale.id }],
    }).expect(201);
    expect(order.body.total).toBe('40');
    expect(order.body.items[0].quantity).toBe(20);
  });

  it('asks for name and phone on the first order only, and never lets an order overwrite them', async () => {
    const product = await productWithBundles();
    const customer = await newCustomer({ fullName: null, contactPhone: null });

    const refused = await checkout(customer.token, { items: [{ productId: product.id, quantity: 1 }] }).expect(400);
    expect(refused.body.code).toBe('CONTACT_REQUIRED');
    expect(refused.body.missing).toEqual({ fullName: true, contactPhone: true });

    await checkout(customer.token, {
      items: [{ productId: product.id, quantity: 1 }],
      fullName: '  أحمد   محمد ',
      contactPhone: '٠١٠١٢٣٤٥٦٧٨',
    }).expect(201);
    await checkout(customer.token, {
      items: [{ productId: product.id, quantity: 1 }],
      fullName: 'Someone Else',
      contactPhone: '01999999999',
    }).expect(201);

    const saved = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(saved.fullName).toBe('أحمد محمد');
    expect(saved.contactPhone).toBe('01012345678');
    // The Telegram-verified phone (old-customer discount) is untouched.
    expect(saved.phone).toBeNull();

    const profile = await request(app.getHttpServer())
      .get('/api/v1/me/profile')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(profile.body).toMatchObject({ needsContact: false, wholesale: false });
  });

  it('serves the public website feed without prices or payment account numbers', async () => {
    await productWithBundles();
    const method = await prisma.paymentMethod.findUniqueOrThrow({ where: { id: methodId } });
    await prisma.paymentMethod.update({ where: { id: method.id }, data: { accountNumber: '01099990000' } });

    const res = await request(app.getHttpServer()).get('/api/v1/store/site').expect(200);
    expect(res.body.terms.length).toBeGreaterThan(100);
    expect(res.body.botUrl).toMatch(/^https:\/\/t\.me\//);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('01099990000');
    expect(body).not.toContain('"price"');
    expect(body).not.toContain('costPrice');
  });
});
