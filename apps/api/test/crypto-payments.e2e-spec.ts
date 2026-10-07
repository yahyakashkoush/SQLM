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
import { PaymentMethodsService } from '../src/modules/payments/payment-methods.service';

/**
 * Approving a payment dispatches fulfillment after the transaction commits,
 * and a worker in this same process then moves the order PAID -> PROCESSING.
 * Whether a read lands before or after that worker is a race, so asserting
 * the exact string `PAID` makes the test a coin flip. What actually matters
 * is that the payment was accepted and the order moved past review; `paidAt`
 * is set once and never cleared, so it is the durable half of that check.
 */
const PAID_OR_LATER = ['PAID', 'PROCESSING', 'READY_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'];
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
      data: { ...E2E_CONTACT, telegramId: BigInt(Date.now() + Math.floor(Math.random() * 1_000_000)) },
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

  /** Any seeded staff row — manual matching records who did it. */
  // Suites run in parallel on one database: borrowing another suite's staff
  // row lets its teardown null out matchedByStaffId mid-test.
  let staffId: string;
  async function anyStaffId() {
    return staffId;
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

    const staff = await prisma.staff.create({
      data: {
        email: `crypto-e2e-${Date.now()}@sqlm.test`,
        passwordHash: 'x',
        name: 'Crypto E2E',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    staffId = staff.id;
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
    await prisma.staff.deleteMany({ where: { id: staffId } });
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
      expect(PAID_OR_LATER).toContain(order.status);
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
      expect(PAID_OR_LATER).toContain(
        (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
      );
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
      expect(PAID_OR_LATER).toContain(
        (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
      );
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

  /**
   * Money that arrived and paid for nothing. Everything here is about the
   * store noticing, and being able to put it right without a DB console.
   */
  describe('stranded deposits', () => {
    it('alerts once for a deposit that matched no order, then never again', async () => {
      const txId = `tx-e2e-stranded-${Date.now()}`;
      await prisma.cryptoDeposit.create({
        data: {
          provider: 'BINANCE',
          txId,
          asset: 'USDT',
          network: 'TRX',
          amount: new Prisma.Decimal('999.111111'),
          // Older than the grace window, so it is stranded rather than
          // simply in flight.
          seenAt: new Date(Date.now() - 60 * 60_000),
        },
      });

      const first = await poller.pollOnce();
      expect(first.alerted).toBeGreaterThanOrEqual(1);
      const afterFirst = await prisma.cryptoDeposit.findUniqueOrThrow({
        where: { provider_txId: { provider: 'BINANCE', txId } },
      });
      expect(afterFirst.alertedAt).not.toBeNull();

      // The sweep runs every 40s; re-alerting would bury the real ones.
      const second = await poller.pollOnce();
      const stillAlerted = await prisma.cryptoDeposit.findUniqueOrThrow({
        where: { provider_txId: { provider: 'BINANCE', txId } },
      });
      expect(stillAlerted.alertedAt).toEqual(afterFirst.alertedAt);
      expect(second.alerted).toBe(0);
    });

    it('offers the near-miss order for an amount that is slightly wrong', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);

      // A last digit mistyped: inside the 1% tolerance.
      const sent = watch.expectedAmount.sub(new Prisma.Decimal('0.000004'));
      const deposit = await prisma.cryptoDeposit.create({
        data: {
          provider: 'BINANCE',
          txId: `tx-e2e-near-${Date.now()}`,
          asset: 'USDT',
          network: 'TRX',
          amount: sent,
          address: 'TTestDepositAddress000000000000000',
        },
      });

      const suggestions = await poller.findNearMisses(deposit);
      expect(suggestions[0]?.orderId).toBe(orderId);
    });

    it('does not offer an order whose amount is nowhere near', async () => {
      const customer = await newCustomer();
      await checkout(customer.token);

      const deposit = await prisma.cryptoDeposit.create({
        data: {
          provider: 'BINANCE',
          txId: `tx-e2e-far-${Date.now()}`,
          asset: 'USDT',
          network: 'TRX',
          amount: new Prisma.Decimal('5000'),
        },
      });

      expect(await poller.findNearMisses(deposit)).toHaveLength(0);
    });

    it('credits a stranded deposit against an order by hand, and pays it', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);

      // Simulate the customer paying after their window closed.
      await prisma.cryptoPaymentWatch.update({
        where: { id: watch.id },
        data: { status: 'EXPIRED', claimKey: null },
      });

      const deposit = await prisma.cryptoDeposit.create({
        data: {
          provider: 'BINANCE',
          txId: `tx-e2e-manual-${Date.now()}`,
          asset: 'USDT',
          network: 'TRX',
          amount: watch.expectedAmount,
        },
      });

      await poller.matchManually(deposit.id, orderId, (await anyStaffId())!);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(PAID_OR_LATER).toContain(order.status);
      expect(order.paidAt).not.toBeNull();

      const credited = await prisma.cryptoDeposit.findUniqueOrThrow({ where: { id: deposit.id } });
      expect(credited.creditedAt).not.toBeNull();
      expect(credited.orderId).toBe(orderId);
      expect(credited.matchedByStaffId).not.toBeNull();
    });

    it('refuses to credit the same deposit twice', async () => {
      const customer = await newCustomer();
      const orderA = await checkout(customer.token);
      const orderB = await checkout(customer.token);
      const staffId = (await anyStaffId())!;

      const deposit = await prisma.cryptoDeposit.create({
        data: {
          provider: 'BINANCE',
          txId: `tx-e2e-twice-${Date.now()}`,
          asset: 'USDT',
          network: 'TRX',
          amount: new Prisma.Decimal('25.5'),
        },
      });

      await poller.matchManually(deposit.id, orderA, staffId);
      await expect(poller.matchManually(deposit.id, orderB, staffId)).rejects.toThrow();

      const b = await prisma.order.findUniqueOrThrow({ where: { id: orderB } });
      expect(b.paidAt).toBeNull();
    });

    it('refuses to credit an order that is already paid', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);
      const staffId = (await anyStaffId())!;

      exchange.deposits = [
        {
          txId: `tx-e2e-alreadypaid-${Date.now()}`,
          asset: 'USDT',
          network: 'TRX',
          amount: watch.expectedAmount.toString(),
          address: 'TTestDepositAddress000000000000000',
          rawStatus: 'SUCCESS',
        },
      ];
      await poller.pollOnce();
      exchange.deposits = [];

      const second = await prisma.cryptoDeposit.create({
        data: {
          provider: 'BINANCE',
          txId: `tx-e2e-extra-${Date.now()}`,
          asset: 'USDT',
          network: 'TRX',
          amount: new Prisma.Decimal('12'),
        },
      });

      await expect(poller.matchManually(second.id, orderId, staffId)).rejects.toThrow();
    });
  });

  describe('extending the deposit window', () => {
    it('pushes the deadline out and keeps the same amount reserved', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const before = await watchFor(orderId);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/crypto-payment/extend`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(201);

      expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(before.expiresAt.getTime());
      // The amount is the identifier, so a transfer already in flight has
      // to keep matching.
      expect(res.body.amount).toBe(before.expectedAmount.toString());
      expect(res.body.extensionsUsed).toBe(1);
    });

    it('stops after the allowed number of extensions', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);

      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/crypto-payment/extend`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/crypto-payment/extend`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/crypto-payment/extend`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(409);
    });

    it('will not extend someone else\'s order', async () => {
      const owner = await newCustomer();
      const stranger = await newCustomer();
      const orderId = await checkout(owner.token);

      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/crypto-payment/extend`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(404);
    });

    it('will not extend a window that already closed', async () => {
      const customer = await newCustomer();
      const orderId = await checkout(customer.token);
      const watch = await watchFor(orderId);
      await prisma.cryptoPaymentWatch.update({
        where: { id: watch.id },
        data: { status: 'EXPIRED', claimKey: null },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/crypto-payment/extend`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(409);
    });
  });
});
