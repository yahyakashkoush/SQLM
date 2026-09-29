import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Letting a customer cancel is really about inventory: a reservation nobody
 * will ever pay for is stock the store cannot sell. The tests that matter
 * are that cancelling gives it back, and that the door closes once money
 * may be in flight.
 */
describe('Customer order cancellation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;

  let quantityProductId: string;
  let individualProductId: string;
  let manualMethodId: string;
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

  async function checkout(token: string, productId = quantityProductId, quantity = 1) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ productId, quantity }],
        paymentMethodId: manualMethodId,
        idempotencyKey: `cancel-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
      .expect(201);
    orderIds.push(res.body.id);
    return res.body.id as string;
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

    const quantityProduct = await prisma.product.create({
      data: {
        slug: `cancel-e2e-qty-${Date.now()}`,
        name: 'Cancellable (quantity)',
        price: 10,
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        fulfillmentType: 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock: 5,
      },
    });
    quantityProductId = quantityProduct.id;

    const individualProduct = await prisma.product.create({
      data: {
        slug: `cancel-e2e-ind-${Date.now()}`,
        name: 'Cancellable (individual)',
        price: 10,
        inventoryMode: 'INDIVIDUAL',
        deliveryType: 'ACCOUNT',
        fulfillmentType: 'ACCOUNT',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
      },
    });
    individualProductId = individualProduct.id;

    const method = await prisma.paymentMethod.create({
      data: { name: 'Cancel E2E Bank', currency: 'USD', enabled: true, provider: 'MANUAL' },
    });
    manualMethodId = method.id;
  });

  afterAll(async () => {
    await prisma.inventoryItem.deleteMany({ where: { productId: individualProductId } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.paymentProof.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({
      where: { id: { in: [quantityProductId, individualProductId] } },
    });
    await prisma.paymentMethod.deleteMany({ where: { id: manualMethodId } });
    await app.close();
  });

  it('cancels an order that is still awaiting payment', async () => {
    const customer = await newCustomer();
    const orderId = await checkout(customer.token);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({})
      .expect(201);

    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.cancelledAt).not.toBeNull();
  });

  it('puts quantity stock back', async () => {
    const customer = await newCustomer();
    const before = await prisma.product.findUniqueOrThrow({ where: { id: quantityProductId } });

    const orderId = await checkout(customer.token, quantityProductId, 2);
    const reserved = await prisma.product.findUniqueOrThrow({ where: { id: quantityProductId } });
    expect(reserved.stock).toBe(before.stock - 2);

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({})
      .expect(201);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: quantityProductId } });
    expect(after.stock).toBe(before.stock);
  });

  it('releases a reserved individual item back to available', async () => {
    const customer = await newCustomer();
    const item = await prisma.inventoryItem.create({
      data: {
        productId: individualProductId,
        encryptedPayload: 'x',
        status: 'AVAILABLE',
      },
    });

    const orderId = await checkout(customer.token, individualProductId, 1);
    const held = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(held.status).toBe('RESERVED');

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({})
      .expect(201);

    const released = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(released.status).toBe('AVAILABLE');
    expect(released.orderId).toBeNull();
  });

  it('records the reason the customer gave', async () => {
    const customer = await newCustomer();
    const orderId = await checkout(customer.token);

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ reason: 'اخترت المنتج الغلط' })
      .expect(201);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.cancelReason).toBe('اخترت المنتج الغلط');
  });

  it('closes the crypto deposit window so the amount returns to the pool', async () => {
    const cryptoMethod = await prisma.paymentMethod.create({
      data: {
        name: 'Cancel E2E USDT',
        currency: 'USD',
        enabled: true,
        provider: 'BINANCE',
        cryptoAsset: 'USDT',
        cryptoNetwork: 'TRX',
        depositAddress: 'TCancelE2EAddress0000000000000000',
        watchTtlMinutes: 30,
      },
    });
    const customer = await newCustomer();

    const res = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        items: [{ productId: quantityProductId, quantity: 1 }],
        paymentMethodId: cryptoMethod.id,
        idempotencyKey: `cancel-e2e-crypto-${Date.now()}`,
      })
      .expect(201);
    orderIds.push(res.body.id);

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${res.body.id}/cancel`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({})
      .expect(201);

    const watch = await prisma.cryptoPaymentWatch.findUnique({ where: { orderId: res.body.id } });
    if (watch) {
      expect(watch.status).toBe('CANCELLED');
      // The claim key is what reserves the amount; holding it after a
      // cancel would retire that amount for good.
      expect(watch.claimKey).toBeNull();
      await prisma.cryptoPaymentWatch.delete({ where: { id: watch.id } });
    }
    await prisma.paymentMethod.delete({ where: { id: cryptoMethod.id } });
  });

  it('refuses once a payment proof is in', async () => {
    const customer = await newCustomer();
    const orderId = await checkout(customer.token);

    // The customer has told us they paid; staff may be mid-review.
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'PAYMENT_SUBMITTED' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({})
      .expect(409);
  });

  it('refuses once the order is paid', async () => {
    const customer = await newCustomer();
    const orderId = await checkout(customer.token);
    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({})
      .expect(409);
  });

  it('will not let one customer cancel another\'s order', async () => {
    const owner = await newCustomer();
    const stranger = await newCustomer();
    const orderId = await checkout(owner.token);

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({})
      .expect(404);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PENDING_PAYMENT');
  });

  it('refuses an anonymous cancel', async () => {
    const customer = await newCustomer();
    const orderId = await checkout(customer.token);

    await request(app.getHttpServer()).post(`/api/v1/orders/${orderId}/cancel`).send({}).expect(401);
  });

  it('is not undone by cancelling twice', async () => {
    const customer = await newCustomer();
    const orderId = await checkout(customer.token);

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({})
      .expect(201);

    // Second attempt is refused rather than releasing the stock again.
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({})
      .expect(409);
  });
});
