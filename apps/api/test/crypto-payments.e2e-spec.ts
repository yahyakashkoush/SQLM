import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { PaymentMethodsService } from '../src/modules/payments/payment-methods.service';
import { DepositPollerService } from '../src/modules/crypto-payments/deposit-poller.service';
import { CryptoWatchService } from '../src/modules/crypto-payments/crypto-watch.service';
import { ExchangeRegistry } from '../src/modules/crypto-payments/exchange/exchange-registry.service';
import type {
  ExchangeClient,
  ExchangeDeposit,
} from '../src/modules/crypto-payments/exchange/exchange-client';

/**
 * A store settles real money here, so the properties that matter are the
 * ones about *not* paying twice and *not* paying the wrong order. The
 * exchange is faked; everything below it — ledger, matching, claiming,
 * the state machine — is the real code path.
 */
class FakeExchange implements ExchangeClient {
  readonly provider = 'BINANCE' as const;
  deposits: ExchangeDeposit[] = [];
  failNext = false;

  isConfigured(): boolean {
    return true;
  }

  async listDeposits(): Promise<ExchangeDeposit[]> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated exchange outage');
    }
    return this.deposits;
  }
}

describe('Crypto auto-payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let poller: DepositPollerService;
  let watches: CryptoWatchService;
  const exchange = new FakeExchange();

  let productId: string;
  let cryptoMethodId: string;
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

  async function checkout(token: string, paymentMethodId = cryptoMethodId) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ productId, quantity: 1 }],
        paymentMethodId,
        idempotencyKey: `crypto-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
      .expect(201);
    orderIds.push(res.body.id);
    return res.body.id as string;
  }

  async function watchFor(orderId: string) {
    return prisma.cryptoPaymentWatch.findUniqueOrThrow({ where: { orderId } });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Swap only the registry: the poller, watch service, ledger and
      // order transitions under test are all the production ones.
      .overrideProvider(ExchangeRegistry)
      .useValue({
        get: () => exchange,
        configured: () => [exchange],
        configuredProviders: () => ['BINANCE'],
        isConfigured: (p: string) => p === 'BINANCE',
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    poller = app.get(DepositPollerService);
    watches = app.get(CryptoWatchService);

    const product = await prisma.product.create({
      data: {
        slug: `crypto-e2e-${Date.now()}`,
        name: 'Crypto E2E Product',
        price: 25,
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        fulfillmentType: 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock: 500,
      },
    });
    productId = product.id;

    const cryptoMethod = await prisma.paymentMethod.create({
      data: {
        name: 'USDT (TRC20)',
        currency: 'USD',
        enabled: true,
        provider: 'BINANCE',
        cryptoAsset: 'USDT',
        cryptoNetwork: 'TRX',
        depositAddress: 'TTestDepositAddress000000000000000',
        watchTtlMinutes: 60,
      },
    });
    cryptoMethodId = cryptoMethod.id;

    const manualMethod = await prisma.paymentMethod.create({
      data: { name: 'Bank transfer', currency: 'USD', enabled: true, provider: 'MANUAL' },
    });
    manualMethodId = manualMethod.id;
  });

  afterAll(async () => {
    await prisma.cryptoDeposit.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.cryptoDeposit.deleteMany({ where: { txId: { startsWith: 'tx-e2e-' } } });
    await prisma.cryptoPaymentWatch.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.paymentMethod.deleteMany({
      where: { id: { in: [cryptoMethodId, manualMethodId] } },
    });
    await app.close();
  });

  beforeEach(() => {
    exchange.deposits = [];
  });

  describe('watch allocation', () => {
    it('opens a watch at checkout with an amount that is not the bare total', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);

      expect(watch.status).toBe('WAITING');
      expect(watch.asset).toBe('USDT');
      expect(watch.network).toBe('TRX');
      // The delta is what identifies the order; without it a deposit
      // could belong to any order of the same price.
      expect(watch.expectedAmount.toString()).not.toBe('25');
      expect(Number(watch.expectedAmount)).toBeGreaterThan(25);
      expect(Number(watch.expectedAmount)).toBeLessThan(25.01);
    });

    it('never gives two open orders the same amount', async () => {
      const customers = await Promise.all([
        newCustomer(),
        newCustomer(),
        newCustomer(),
        newCustomer(),
        newCustomer(),
        newCustomer(),
      ]);
      const ids = await Promise.all(customers.map((c) => checkout(c.token)));
      const allocated = await Promise.all(ids.map((id) => watchFor(id)));

      const amounts = allocated.map((w) => w.expectedAmount.toString());
      expect(new Set(amounts).size).toBe(amounts.length);
    });

    it('frees the amount again once a watch expires', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);
      expect(watch.claimKey).not.toBeNull();

      await prisma.cryptoPaymentWatch.update({
        where: { id: watch.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await watches.expireStale();

      const after = await watchFor(orderId);
      expect(after.status).toBe('EXPIRED');
      // A held claim key would keep that amount unusable forever.
      expect(after.claimKey).toBeNull();
    });

    it('does not open a watch for a manual payment method', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token, manualMethodId);
      const watch = await prisma.cryptoPaymentWatch.findUnique({ where: { orderId } });
      expect(watch).toBeNull();
    });
  });

  describe('method configuration', () => {
    // Swapping the network without replacing the address is the one mistake
    // in this feature that destroys money instead of failing: a deposit sent
    // to an address from another chain is normally unrecoverable, and nothing
    // downstream can catch it because the poller only sees deposits that did
    // arrive. So it has to be refused at save time.
    const methods = () => app.get(PaymentMethodsService);
    const evmAddress = '0x79e27f54b7d3d49b5a1ab6820fd94c81c3f116ee';
    const tronAddress = 'TEsNLZMOaZfxwEEhcgQxkvcCNGLZBdxCMt';

    async function save(network: string, address: string) {
      return methods().create({
        name: `cfg-${network}-${Date.now()}`,
        currency: 'USD',
        enabled: true,
        provider: 'BINANCE',
        cryptoAsset: 'USDT',
        cryptoNetwork: network,
        depositAddress: address,
      } as never);
    }

    it('refuses an EVM address on Tron', async () => {
      await expect(save('TRX', evmAddress)).rejects.toThrow(/not a valid TRX address/);
    });

    it('refuses an EVM address on Solana', async () => {
      await expect(save('SOL', evmAddress)).rejects.toThrow(/not a valid SOL address/);
    });

    it('refuses a Tron address on an EVM chain', async () => {
      await expect(save('BSC', tronAddress)).rejects.toThrow(/not a valid BSC address/);
    });

    it('accepts an address that matches its network', async () => {
      const created = await save('BSC', evmAddress);
      expect(created.cryptoNetwork).toBe('BSC');
      await prisma.paymentMethod.delete({ where: { id: created.id } });
    });

    it('refuses a crypto method with no address at all', async () => {
      await expect(save('TRX', '')).rejects.toThrow(/depositAddress/);
    });
  });

  describe('settlement', () => {
    it('marks the order paid when the exact amount arrives', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);

      exchange.deposits = [
        {
          txId: `tx-e2e-${Date.now()}`,
          asset: 'USDT',
          network: 'TRX',
          amount: watch.expectedAmount.toString(),
        },
      ];

      const summary = await poller.pollOnce();
      expect(summary.settled).toBe(1);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('PAID');
      expect(order.paidAt).not.toBeNull();
      expect((await watchFor(orderId)).status).toBe('MATCHED');
    });

    it('credits a deposit once even when the exchange keeps reporting it', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);
      const txId = `tx-e2e-repeat-${Date.now()}`;

      exchange.deposits = [
        { txId, asset: 'USDT', network: 'TRX', amount: watch.expectedAmount.toString() },
      ];

      // The lookback window re-reports the same deposit on every sweep,
      // so this is the normal case, not an edge case.
      const first = await poller.pollOnce();
      const second = await poller.pollOnce();
      const third = await poller.pollOnce();

      expect(first.settled).toBe(1);
      expect(second.settled).toBe(0);
      expect(third.settled).toBe(0);

      const ledger = await prisma.cryptoDeposit.findMany({ where: { txId } });
      expect(ledger).toHaveLength(1);

      const paidEvents = await prisma.orderEvent.findMany({
        where: { orderId, type: 'CRYPTO_PAYMENT_DETECTED' },
      });
      expect(paidEvents).toHaveLength(1);
    });

    it('settles once when two sweeps run concurrently', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);
      const txId = `tx-e2e-race-${Date.now()}`;

      exchange.deposits = [
        { txId, asset: 'USDT', network: 'TRX', amount: watch.expectedAmount.toString() },
      ];

      // Two replicas picking the repeatable job up at the same instant.
      const results = await Promise.all([
        poller.pollOnce(),
        poller.pollOnce(),
        poller.pollOnce(),
      ]);

      const totalSettled = results.reduce((sum, r) => sum + r.settled, 0);
      expect(totalSettled).toBe(1);

      const events = await prisma.orderEvent.findMany({
        where: { orderId, type: 'STATUS_CHANGED', note: { contains: 'PAID' } },
      });
      expect(events.length).toBeLessThanOrEqual(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('PAID');
    });

    it('leaves the order alone when the amount is off by one unit', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);
      const wrong = new Prisma.Decimal(watch.expectedAmount.toString()).add('0.000001');

      exchange.deposits = [
        {
          txId: `tx-e2e-wrong-${Date.now()}`,
          asset: 'USDT',
          network: 'TRX',
          amount: wrong.toString(),
        },
      ];

      const summary = await poller.pollOnce();
      expect(summary.settled).toBe(0);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'PENDING_PAYMENT',
      );
    });

    it('does not settle the right amount arriving on the wrong network', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);

      exchange.deposits = [
        {
          txId: `tx-e2e-network-${Date.now()}`,
          asset: 'USDT',
          network: 'BSC',
          amount: watch.expectedAmount.toString(),
        },
      ];

      const summary = await poller.pollOnce();
      expect(summary.settled).toBe(0);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'PENDING_PAYMENT',
      );
    });

    it('does not pay an expired watch', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);

      await prisma.cryptoPaymentWatch.update({
        where: { id: watch.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await watches.expireStale();

      exchange.deposits = [
        {
          txId: `tx-e2e-late-${Date.now()}`,
          asset: 'USDT',
          network: 'TRX',
          amount: watch.expectedAmount.toString(),
        },
      ];

      const summary = await poller.pollOnce();
      expect(summary.settled).toBe(0);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'PENDING_PAYMENT',
      );
    });

    it('settles a deposit that arrived before its watch was open', async () => {
      const customer = await newCustomer();
      const txId = `tx-e2e-early-${Date.now()}`;

      // Ingested with nothing to match: an impatient customer, or a sweep
      // that landed between checkout committing and the watch opening.
      exchange.deposits = [
        { txId, asset: 'USDT', network: 'TRX', amount: '25.007777' },
      ];
      const first = await poller.pollOnce();
      expect(first.settled).toBe(0);

      const orderId = await checkout(customer.token);
      await prisma.cryptoPaymentWatch.update({
        where: { orderId },
        data: {
          expectedAmount: new Prisma.Decimal('25.007777'),
          claimKey: 'BINANCE:USDT:TRX:25.00777700',
        },
      });

      // The ledger is re-examined every sweep, so the stored deposit is
      // picked up now rather than being lost with the API response.
      const second = await poller.pollOnce();
      expect(second.settled).toBe(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('PAID');
    });

    it('keeps sweeping after an exchange error', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);

      exchange.failNext = true;
      const failed = await poller.pollOnce();
      expect(failed.errors).toHaveLength(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'PENDING_PAYMENT',
      );

      exchange.deposits = [
        {
          txId: `tx-e2e-recover-${Date.now()}`,
          asset: 'USDT',
          network: 'TRX',
          amount: watch.expectedAmount.toString(),
        },
      ];
      const recovered = await poller.pollOnce();
      expect(recovered.settled).toBe(1);
    });
  });

  describe('customer endpoint', () => {
    it('returns the address and exact amount for the order owner', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}/crypto-payment`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);

      expect(res.body.address).toBe('TTestDepositAddress000000000000000');
      expect(res.body.amount).toBe(watch.expectedAmount.toString());
      expect(res.body.asset).toBe('USDT');
      expect(res.body.status).toBe('WAITING');
      expect(res.body.autoConfirmActive).toBe(true);
    });

    it('does not expose another customer\'s payment details', async () => {
      const owner = await newCustomer();
      const stranger = await newCustomer();
      const orderId = await checkout(owner.token);

      await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}/crypto-payment`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(404);
    });

    it('opens the watch on demand when checkout could not', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      await prisma.cryptoPaymentWatch.delete({ where: { orderId } });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}/crypto-payment`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);

      expect(res.body.status).toBe('WAITING');
      expect(Number(res.body.amount)).toBeGreaterThan(25);
    });
  });
});
