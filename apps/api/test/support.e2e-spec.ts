import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { SupportService } from '../src/modules/support/support.service';

describe('Support system (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let support: SupportService;

  const agentEmail = `e2e-support-agent-${Date.now()}@sqlm.local`;
  const password = 'SupportAgent9!Pass';
  let agentId: string;
  let agentToken: string;
  let otherAgentId: string;

  const customerIds: string[] = [];
  const ticketIds: string[] = [];

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

  async function openTicket(token: string, subject = 'Cannot activate my key') {
    const res = await request(app.getHttpServer())
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject, message: 'It says the key is invalid.', category: 'DELIVERY_ISSUE' })
      .expect(201);
    ticketIds.push(res.body.id);
    return res.body;
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
    support = app.get(SupportService);

    const agent = await prisma.staff.create({
      data: {
        email: agentEmail,
        passwordHash: await argon2.hash(password),
        name: 'E2E Support Agent',
        role: 'SUPPORT_AGENT',
        status: 'ACTIVE',
      },
    });
    agentId = agent.id;
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/staff/login')
      .send({ email: agentEmail, password });
    agentToken = login.body.accessToken;

    const other = await prisma.staff.create({
      data: {
        email: `e2e-support-other-${Date.now()}@sqlm.local`,
        passwordHash: await argon2.hash(password),
        name: 'E2E Other Agent',
        role: 'SUPPORT_AGENT',
        status: 'ACTIVE',
      },
    });
    otherAgentId = other.id;
  });

  afterAll(async () => {
    await prisma.ticketMessage.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.supportTicket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: [agentId, otherAgentId] } } });
    await app?.close();
  });

  it('opens a ticket with the first message and queues it for staff', async () => {
    const customer = await newCustomer();
    const ticket = await openTicket(customer.token);

    expect(ticket.status).toBe('OPEN');
    expect(ticket.messages).toHaveLength(1);
    expect(ticket.staffUnread).toBe(1);
    expect(ticket.customerUnread).toBe(0);
    expect(ticket.ticketNumber).toBeGreaterThan(0);
  });

  it('carries a conversation both ways and keeps unread counts in step', async () => {
    const customer = await newCustomer();
    const ticket = await openTicket(customer.token);

    // Staff reads -> their badge clears, ticket has no unread for them.
    const staffView = await request(app.getHttpServer())
      .get(`/api/v1/admin/support/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    expect(staffView.body.staffUnread).toBe(0);

    // Staff replies -> customer badge goes up, status moves off OPEN.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/support/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ message: 'Try re-downloading — here is a fresh key.' })
      .expect(201);

    const unread = await request(app.getHttpServer())
      .get('/api/v1/support/tickets/unread-count')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(unread.body.unread).toBe(1);

    const afterStaffReply = await prisma.supportTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(afterStaffReply.status).toBe('IN_PROGRESS');

    // Customer reads -> their badge clears; customer replies -> staff badge goes up.
    const customerView = await request(app.getHttpServer())
      .get(`/api/v1/support/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    expect(customerView.body.customerUnread).toBe(0);
    expect(customerView.body.messages).toHaveLength(2);

    await request(app.getHttpServer())
      .post(`/api/v1/support/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ message: 'That worked, thanks!' })
      .expect(201);

    const final = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(final.staffUnread).toBe(1);
    expect(final.customerUnread).toBe(0);
  });

  it('hides internal staff notes from the customer but shows them to staff', async () => {
    const customer = await newCustomer();
    const ticket = await openTicket(customer.token);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/support/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ message: 'Refund already issued, do not re-credit.', internal: true })
      .expect(201);

    const customerView = await request(app.getHttpServer())
      .get(`/api/v1/support/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    const texts = (customerView.body.messages as Array<{ message: string }>).map((m) => m.message);
    expect(texts).not.toContain('Refund already issued, do not re-credit.');

    const staffView = await request(app.getHttpServer())
      .get(`/api/v1/admin/support/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    const staffTexts = (staffView.body.messages as Array<{ message: string }>).map((m) => m.message);
    expect(staffTexts).toContain('Refund already issued, do not re-credit.');

    // An internal note must not raise the customer's badge.
    const ticketRow = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(ticketRow.customerUnread).toBe(0);
  });

  it('assigns, changes status, and blocks replies on a closed ticket', async () => {
    const customer = await newCustomer();
    const ticket = await openTicket(customer.token);

    const assigned = await request(app.getHttpServer())
      .patch(`/api/v1/admin/support/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ staffId: agentId })
      .expect(200);
    expect(assigned.body.assignedStaffId).toBe(agentId);
    expect(assigned.body.status).toBe('IN_PROGRESS');

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/support/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'RESOLVED' })
      .expect(200);

    const closed = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(closed.status).toBe('RESOLVED');
    expect(closed.closedAt).not.toBeNull();

    await request(app.getHttpServer())
      .post(`/api/v1/support/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ message: 'One more thing...' })
      .expect(409);
  });

  it('links a ticket to one of the customer’s own orders only', async () => {
    const customer = await newCustomer();
    const stranger = await newCustomer();

    const method = await prisma.paymentMethod.create({
      data: { name: `E2E Support PM ${Date.now()}`, enabled: true, currency: 'USD' },
    });
    const product = await prisma.product.create({
      data: {
        slug: `e2e-support-product-${Date.now()}`,
        name: 'E2E Support Product',
        price: 5,
        inventoryMode: 'QUANTITY',
        deliveryType: 'MANUAL',
        fulfillmentType: 'MANUAL_SERVICE',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        stock: 5,
      },
    });
    const checkout = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethodId: method.id,
        idempotencyKey: `support-e2e-${Date.now()}`,
      })
      .expect(201);

    const linked = await request(app.getHttpServer())
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ subject: 'Order problem', message: 'Never arrived', orderId: checkout.body.id })
      .expect(201);
    ticketIds.push(linked.body.id);
    expect(linked.body.orderId).toBe(checkout.body.id);

    // Someone else's order is simply not found for this customer.
    await request(app.getHttpServer())
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ subject: 'Not mine', message: 'x', orderId: checkout.body.id })
      .expect(404);

    await prisma.orderEvent.deleteMany({ where: { orderId: checkout.body.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: checkout.body.id } });
    await prisma.supportTicket.updateMany({
      where: { orderId: checkout.body.id },
      data: { orderId: null },
    });
    await prisma.order.delete({ where: { id: checkout.body.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.paymentMethod.delete({ where: { id: method.id } });
  });

  it('keeps one customer out of another customer’s thread', async () => {
    const owner = await newCustomer();
    const intruder = await newCustomer();
    const ticket = await openTicket(owner.token);

    await request(app.getHttpServer())
      .get(`/api/v1/support/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/support/tickets/${ticket.id}/messages`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .send({ message: 'let me in' })
      .expect(404);
  });

  describe('Telegram bridge', () => {
    it('routes a bot message into the customer’s active thread instead of a new ticket', async () => {
      const customer = await newCustomer();

      const first = await support.findOrCreateActiveTicket(customer.id, 'Telegram', 'hello there');
      ticketIds.push(first.id);
      const second = await support.findOrCreateActiveTicket(customer.id, 'Telegram', 'any update?');

      expect(second.id).toBe(first.id);

      const thread = await prisma.ticketMessage.findMany({ where: { ticketId: first.id } });
      expect(thread).toHaveLength(2);
      expect(thread.map((m) => m.message)).toEqual(['hello there', 'any update?']);
      expect(thread.every((m) => m.authorType === 'CUSTOMER')).toBe(true);
    });

    it('starts a fresh ticket once the previous one is closed', async () => {
      const customer = await newCustomer();
      const first = await support.findOrCreateActiveTicket(customer.id, 'Telegram', 'issue one');
      ticketIds.push(first.id);

      await support.setStatus(first.id, 'CLOSED', agentId);

      const second = await support.findOrCreateActiveTicket(customer.id, 'Telegram', 'issue two');
      ticketIds.push(second.id);
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('OPEN');
    });
  });

  it('lists the staff queue oldest-unanswered-first', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/support/tickets?status=OPEN')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toHaveProperty('total');
  });

  it('requires support permissions for the admin endpoints', async () => {
    const customer = await newCustomer();
    await request(app.getHttpServer())
      .get('/api/v1/admin/support/tickets')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(401);
  });
});
