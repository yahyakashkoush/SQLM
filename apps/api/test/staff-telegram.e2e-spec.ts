import { E2E_CONTACT } from './fixtures';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { StaffRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { StaffTelegramService } from '../src/modules/telegram/staff-telegram.service';
import { StaffAlertRenderer } from '../src/modules/telegram/staff-alert.renderer';
import { StaffNotifier } from '../src/modules/telegram/staff-notifier.service';
import { TelegramBotService } from '../src/modules/telegram/telegram-bot.service';

const PAID_OR_LATER = ['PAID', 'PROCESSING', 'READY_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'];

/** A minimal but valid PNG — the upload path checks magic bytes. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

/** Distinct bytes per upload: the same receipt from another customer is refused as a copy. */
const uniquePng = () => Buffer.concat([PNG, Buffer.from(Math.random().toString(36))]);

/**
 * Staff on Telegram: linking an account from the dashboard, and reviewing
 * payments from the phone.
 *
 * The bot never reaches Telegram under NODE_ENV=test, so these drive the
 * services the bot's handlers are thin wrappers around, plus the renderer
 * that decides what a store owner sees and which buttons they get.
 */
describe('Staff Telegram alerts and payment review (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let staffTelegram: StaffTelegramService;
  let renderer: StaffAlertRenderer;

  const staffIds: string[] = [];
  const customerIds: string[] = [];
  const orderIds: string[] = [];
  const productIds: string[] = [];
  let methodId: string;
  let egpMethodId: string;
  let tgSeq = Math.floor(Math.random() * 1_000_000);
  const nextTelegramId = () => 7_000_000_000 + tgSeq++;

  const token = (sub: string, type: 'customer' | 'staff') =>
    jwt.sign({ sub, type }, { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '1h' });

  async function newStaff(role: StaffRole, telegramId?: number) {
    const staff = await prisma.staff.create({
      data: {
        email: `tg-e2e-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@sqlm.local`,
        passwordHash: 'x',
        name: `TG ${role}`,
        role,
        status: 'ACTIVE',
        telegramId: telegramId !== undefined ? BigInt(telegramId) : undefined,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  /** A customer with an order awaiting review and its uploaded proof. */
  async function orderWithProof(method = methodId) {
    const customer = await prisma.customer.create({
      data: { ...E2E_CONTACT, telegramId: BigInt(nextTelegramId()), firstName: 'Mona', telegramUsername: 'mona_e2e' },
    });
    customerIds.push(customer.id);
    const product = await prisma.product.create({
      data: {
        slug: `tg-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: 'Netflix Premium',
        price: 3,
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        fulfillmentType: 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock: 10,
      },
    });
    productIds.push(product.id);

    const customerToken = token(customer.id, 'customer');
    const order = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId: method,
        idempotencyKey: `tg-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
      .expect(201);
    orderIds.push(order.body.id);

    const proof = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.body.id}/payment-proof`)
      .set('Authorization', `Bearer ${customerToken}`)
      .attach('file', uniquePng(), { filename: 'receipt.png', contentType: 'image/png' })
      .expect(201);

    return { orderId: order.body.id as string, sequenceNumber: order.body.sequenceNumber as number, proofId: proof.body.id as string };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    staffTelegram = app.get(StaffTelegramService);
    renderer = app.get(StaffAlertRenderer);

    const method = await prisma.paymentMethod.create({
      data: { name: 'TG E2E Bank', currency: 'USD', enabled: true, provider: 'MANUAL' },
    });
    const egp = await prisma.paymentMethod.create({
      data: { name: 'TG E2E Vodafone Cash', currency: 'EGP', enabled: true, provider: 'MANUAL' },
    });
    methodId = method.id;
    egpMethodId = egp.id;
  });

  afterAll(async () => {
    await prisma.paymentProof.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.paymentMethod.deleteMany({ where: { id: { in: [methodId, egpMethodId] } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  describe('linking', () => {
    it('links the Telegram account that opens the one-time link, once', async () => {
      const staff = await newStaff('OWNER');
      const telegramId = nextTelegramId();
      const { token: linkToken } = await staffTelegram.createLinkToken(staff.id);

      const linked = await staffTelegram.linkFromToken(linkToken, telegramId);
      expect(linked?.id).toBe(staff.id);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
      expect(row.telegramId).toBe(BigInt(telegramId));

      // A forwarded or re-opened link attaches nothing.
      expect(await staffTelegram.linkFromToken(linkToken, nextTelegramId())).toBeNull();
    });

    it('moves a Telegram account to the staff member who linked it last', async () => {
      const telegramId = nextTelegramId();
      const first = await newStaff('ADMIN', telegramId);
      const second = await newStaff('ADMIN');
      const { token: linkToken } = await staffTelegram.createLinkToken(second.id);
      await staffTelegram.linkFromToken(linkToken, telegramId);

      expect((await prisma.staff.findUniqueOrThrow({ where: { id: first.id } })).telegramId).toBeNull();
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: second.id } })).telegramId).toBe(BigInt(telegramId));
    });

    it('lets a signed-in staff member see, mute and unlink their own link', async () => {
      const staff = await newStaff('SUPPORT_AGENT', nextTelegramId());
      const auth = `Bearer ${token(staff.id, 'staff')}`;

      await request(app.getHttpServer())
        .get('/api/v1/admin/bot/me')
        .set('Authorization', auth)
        .expect(200, { linked: true, notify: true });
      await request(app.getHttpServer())
        .patch('/api/v1/admin/bot/me')
        .set('Authorization', auth)
        .send({ notify: false })
        .expect(200, { linked: true, notify: false });
      await request(app.getHttpServer())
        .delete('/api/v1/admin/bot/me/link')
        .set('Authorization', auth)
        .expect(200, { linked: false, notify: false });
    });

    it('says the bot is unavailable rather than handing out a broken link', async () => {
      const staff = await newStaff('OWNER');
      await request(app.getHttpServer())
        .post('/api/v1/admin/bot/me/link')
        .set('Authorization', `Bearer ${token(staff.id, 'staff')}`)
        .expect(503);
    });
  });

  describe('who gets alerts', () => {
    it('only linked, active staff with alerts on whose role allows the alert', async () => {
      const owner = await newStaff('OWNER', nextTelegramId());
      const support = await newStaff('SUPPORT_AGENT', nextTelegramId());
      const muted = await newStaff('ADMIN', nextTelegramId());
      await prisma.staff.update({ where: { id: muted.id }, data: { telegramNotify: false } });
      const unlinked = await newStaff('ADMIN');

      const reviewers = (await staffTelegram.recipients('payments.proofs.read')).map((s) => s.id);
      expect(reviewers).toContain(owner.id);
      expect(reviewers).not.toContain(support.id);
      expect(reviewers).not.toContain(muted.id);
      expect(reviewers).not.toContain(unlinked.id);

      const supportRecipients = (await staffTelegram.recipients('support.read')).map((s) => s.id);
      expect(supportRecipients).toContain(support.id);
    });

    it('pushes a proof alert to each recipient, and one failing does not stop the rest', async () => {
      const blockedTelegramId = nextTelegramId();
      await newStaff('OWNER', blockedTelegramId);
      await newStaff('OWNER', nextTelegramId());
      const { orderId } = await orderWithProof();

      // Fails for one specific chat, not "the first call": the queue worker
      // in this process may deliver the upload's own alert concurrently.
      const bot = app.get(TelegramBotService);
      const spy = jest.spyOn(bot, 'sendStaffAlert').mockImplementation(async (telegramId) => {
        if (telegramId === BigInt(blockedTelegramId)) throw new Error('403: bot was blocked by the user');
      });
      try {
        const recipients = await staffTelegram.recipients('payments.proofs.read');
        const sent = await app.get(StaffNotifier).deliver({
          kind: 'payment.submitted',
          audience: 'STAFF',
          orderId,
          summary: 'proof',
        });
        expect(recipients.length).toBeGreaterThanOrEqual(2);
        expect(sent).toBe(recipients.length - 1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('what staff see', () => {
    it('renders a proof alert with the screenshot, the order, and approve/reject buttons', async () => {
      const { orderId, sequenceNumber, proofId } = await orderWithProof(egpMethodId);
      const alert = await renderer.render({ kind: 'payment.submitted', audience: 'STAFF', orderId, summary: '' });

      expect(alert).not.toBeNull();
      expect(alert!.permission).toBe('payments.proofs.read');
      expect(alert!.text).toContain(`#${sequenceNumber}`);
      expect(alert!.text).toContain('Netflix Premium × 1');
      expect(alert!.text).toContain('@mona_e2e');
      // USD price paid through an EGP method: the amount to check on the receipt.
      expect(alert!.text).toContain('150 EGP');
      expect(alert!.text.length).toBeLessThanOrEqual(1024);
      expect(alert!.file?.asPhoto).toBe(true);
      expect(alert!.file?.buffer.subarray(0, 4)).toEqual(PNG.subarray(0, 4));
      expect(alert!.buttons[0]).toEqual([
        { text: '✅ قبول', callbackData: `pa:${proofId}` },
        { text: '❌ رفض', callbackData: `pr:${proofId}` },
      ]);
      for (const row of alert!.buttons) {
        for (const button of row) expect(Buffer.byteLength(button.callbackData ?? '')).toBeLessThanOrEqual(64);
      }
    });

    it('does not push a payment that staff just reviewed themselves, but does push one the poller settled', async () => {
      const { orderId } = await orderWithProof();
      expect(await renderer.render({ kind: 'payment.reviewed', audience: 'STAFF', orderId, summary: '' })).toBeNull();

      const auto = await renderer.render({
        kind: 'payment.reviewed',
        audience: 'STAFF',
        orderId,
        summary: '',
        autoSettled: true,
      });
      expect(auto?.text).toContain('اتدفع تلقائي');
    });
  });

  describe('reviewing from Telegram', () => {
    it('approves as the linked staff member, and the order is paid', async () => {
      const telegramId = nextTelegramId();
      const owner = await newStaff('OWNER', telegramId);
      const { orderId, proofId } = await orderWithProof();

      const outcome = await staffTelegram.approve(telegramId, proofId);
      expect(outcome).toEqual({ ok: true, staffName: owner.name });

      const proof = await prisma.paymentProof.findUniqueOrThrow({ where: { id: proofId } });
      expect(proof.status).toBe('APPROVED');
      expect(proof.reviewedById).toBe(owner.id);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(PAID_OR_LATER).toContain(order.status);

      // A second tap — or a second admin's copy of the alert — changes nothing.
      const again = await staffTelegram.approve(telegramId, proofId);
      expect(again).toMatchObject({ ok: false, alreadyReviewed: true });
    });

    it('rejects with a reason and sends the order back for a new proof', async () => {
      const telegramId = nextTelegramId();
      await newStaff('PAYMENT_REVIEWER', telegramId);
      const { orderId, proofId } = await orderWithProof();

      const outcome = await staffTelegram.reject(telegramId, proofId, 'المبلغ المحوّل ناقص');
      expect(outcome.ok).toBe(true);

      const proof = await prisma.paymentProof.findUniqueOrThrow({ where: { id: proofId } });
      expect(proof.status).toBe('REJECTED');
      expect(proof.rejectionReason).toBe('المبلغ المحوّل ناقص');
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('PENDING_PAYMENT');
    });

    it('refuses an account that is not linked, or whose role cannot review payments', async () => {
      const supportTelegram = nextTelegramId();
      await newStaff('SUPPORT_AGENT', supportTelegram);
      const { proofId } = await orderWithProof();

      expect((await staffTelegram.approve(nextTelegramId(), proofId)).ok).toBe(false);
      expect((await staffTelegram.approve(supportTelegram, proofId)).ok).toBe(false);
      expect((await staffTelegram.reject(supportTelegram, proofId, 'no')).ok).toBe(false);

      const proof = await prisma.paymentProof.findUniqueOrThrow({ where: { id: proofId } });
      expect(proof.status).toBe('PENDING');
    });

    it('refuses a disabled staff member even though the account is still linked', async () => {
      const telegramId = nextTelegramId();
      const staff = await newStaff('OWNER', telegramId);
      await prisma.staff.update({ where: { id: staff.id }, data: { status: 'DISABLED' } });
      const { proofId } = await orderWithProof();

      expect((await staffTelegram.approve(telegramId, proofId)).ok).toBe(false);
    });

    it('takes a typed reason exactly once', async () => {
      const chatId = nextTelegramId();
      await staffTelegram.armCustomReason(chatId, 'proof-id:42');
      expect(await staffTelegram.consumeCustomReason(chatId)).toBe('proof-id:42');
      // The next message is an ordinary message again.
      expect(await staffTelegram.consumeCustomReason(chatId)).toBeNull();
    });
  });
});
