import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaginatedResult, TicketCategory, TicketStatus } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { TicketClosedError } from './errors/support.errors';
import type { CreateTicketDto, TicketQueryDto } from './dto/ticket.dto';

/** Who is acting on a ticket. Customers reach it through the Mini App or the bot; staff through the dashboard. */
export type TicketActor =
  | { type: 'CUSTOMER'; customerId: string }
  | { type: 'STAFF'; staffId: string }
  | { type: 'SYSTEM' };

const CLOSED_STATUSES: readonly TicketStatus[] = ['RESOLVED', 'CLOSED'];

/**
 * One conversation model shared by every channel. A message posted from
 * the Telegram bot and one posted from the Admin Dashboard are the same
 * row in the same thread — that is what makes the Telegram <-> Admin
 * bridge work without a second, drift-prone store.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  async createTicket(customerId: string, dto: CreateTicketDto) {
    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, customerId },
      });
      if (!order) throw new NotFoundException('Order not found');
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        customerId,
        subject: dto.subject,
        category: (dto.category ?? 'OTHER') as TicketCategory,
        orderId: dto.orderId,
        status: 'OPEN',
        staffUnread: 1,
        lastMessageAt: new Date(),
        messages: {
          create: {
            authorType: 'CUSTOMER',
            authorCustomerId: customerId,
            message: dto.message,
          },
        },
      },
      include: { messages: true },
    });

    await this.notifications.notifyStaff({
      kind: 'support.ticket_created',
      ticketId: ticket.id,
      summary: `New support ticket #${ticket.ticketNumber}: ${ticket.subject}`,
    });

    return ticket;
  }

  /**
   * Appends to the thread and moves the unread counters in one transaction,
   * so a badge can never disagree with the messages behind it.
   */
  async addMessage(ticketId: string, actor: TicketActor, message: string, internal = false) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (actor.type === 'CUSTOMER' && ticket.customerId !== actor.customerId) {
      throw new NotFoundException('Ticket not found');
    }
    if (actor.type === 'CUSTOMER' && CLOSED_STATUSES.includes(ticket.status as TicketStatus)) {
      throw new TicketClosedError(ticketId);
    }

    const fromCustomer = actor.type === 'CUSTOMER';

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticketMessage.create({
        data: {
          ticketId,
          authorType: actor.type,
          authorCustomerId: actor.type === 'CUSTOMER' ? actor.customerId : undefined,
          authorStaffId: actor.type === 'STAFF' ? actor.staffId : undefined,
          message,
          internal,
        },
      });

      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          lastMessageAt: new Date(),
          // An internal staff note is invisible to the customer, so it must
          // not bump their unread badge.
          ...(internal
            ? {}
            : fromCustomer
              ? { staffUnread: { increment: 1 }, customerUnread: 0 }
              : { customerUnread: { increment: 1 }, staffUnread: 0 }),
          ...(fromCustomer && ticket.status === 'WAITING_CUSTOMER'
            ? { status: 'WAITING_ADMIN' as TicketStatus }
            : {}),
          ...(!fromCustomer && !internal && ticket.status === 'OPEN'
            ? { status: 'IN_PROGRESS' as TicketStatus }
            : {}),
        },
      });

      return created;
    });

    if (internal) return result;

    if (fromCustomer) {
      await this.notifications.notifyStaff({
        kind: 'support.customer_reply',
        ticketId,
        summary: `Reply on ticket #${ticket.ticketNumber}`,
      });
    } else {
      await this.notifications.notifyCustomer(ticket.customerId, {
        kind: 'support.staff_reply',
        ticketId,
        summary: `Support replied to ticket #${ticket.ticketNumber}`,
        body: message,
      });
    }

    return result;
  }

  async listForCustomer(customerId: string, query: TicketQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.SupportTicketWhereInput = {
      customerId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    } satisfies PaginatedResult<(typeof items)[number]>;
  }

  /** Reading a thread clears that side's badge. Internal notes are stripped for customers. */
  async getThread(ticketId: string, actor: TicketActor) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        order: { select: { id: true, sequenceNumber: true, status: true, total: true } },
        customer: { select: { id: true, firstName: true, telegramUsername: true } },
        assignedStaff: { select: { id: true, name: true, email: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (actor.type === 'CUSTOMER' && ticket.customerId !== actor.customerId) {
      throw new NotFoundException('Ticket not found');
    }

    if (actor.type === 'CUSTOMER') {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { customerUnread: 0 },
      });
      return {
        ...ticket,
        customerUnread: 0,
        messages: ticket.messages.filter((m: { internal: boolean }) => !m.internal),
      };
    }

    if (actor.type === 'STAFF') {
      await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { staffUnread: 0 } });
      return { ...ticket, staffUnread: 0 };
    }

    return ticket;
  }

  async listAdmin(query: TicketQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.SupportTicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignedStaffId ? { assignedStaffId: query.assignedStaffId } : {}),
      ...(query.unassigned ? { assignedStaffId: null } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          customer: { select: { id: true, firstName: true, telegramUsername: true } },
          assignedStaff: { select: { id: true, name: true } },
        },
        // Oldest unanswered first — a support queue, not a feed.
        orderBy: [{ staffUnread: 'desc' }, { lastMessageAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async assign(ticketId: string, staffId: string | null) {
    await this.ensureExists(ticketId);
    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        assignedStaffId: staffId,
        ...(staffId ? { status: 'IN_PROGRESS' as TicketStatus } : {}),
      },
    });
  }

  async setStatus(ticketId: string, status: TicketStatus, staffId: string) {
    await this.ensureExists(ticketId);
    const ticket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status,
        ...(CLOSED_STATUSES.includes(status) ? { closedAt: new Date() } : { closedAt: null }),
      },
    });

    await this.prisma.ticketMessage.create({
      data: {
        ticketId,
        authorType: 'STAFF',
        authorStaffId: staffId,
        message: `Status changed to ${status}`,
        internal: true,
      },
    });

    if (CLOSED_STATUSES.includes(status)) {
      await this.notifications.notifyCustomer(ticket.customerId, {
        kind: 'support.ticket_closed',
        ticketId,
        summary: `Ticket #${ticket.ticketNumber} was marked ${status.toLowerCase()}`,
      });
    }

    return ticket;
  }

  /** Badge counts for the dashboard header and the Mini App tab. */
  async unreadCounts(actor: TicketActor) {
    if (actor.type === 'CUSTOMER') {
      const agg = await this.prisma.supportTicket.aggregate({
        where: { customerId: actor.customerId },
        _sum: { customerUnread: true },
      });
      return { unread: agg._sum.customerUnread ?? 0 };
    }
    const agg = await this.prisma.supportTicket.aggregate({ _sum: { staffUnread: true } });
    const openTickets = await this.prisma.supportTicket.count({
      where: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
    });
    return { unread: agg._sum.staffUnread ?? 0, openTickets };
  }

  /** Used by the Telegram bot: the customer's most recent open thread, or a new one. */
  async findOrCreateActiveTicket(customerId: string, subject: string, message: string) {
    const existing = await this.prisma.supportTicket.findFirst({
      where: { customerId, status: { notIn: ['RESOLVED', 'CLOSED'] } },
      orderBy: { lastMessageAt: 'desc' },
    });

    if (existing) {
      await this.addMessage(existing.id, { type: 'CUSTOMER', customerId }, message);
      return existing;
    }
    return this.createTicket(customerId, { subject, message });
  }

  private async ensureExists(ticketId: string) {
    const exists = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Ticket not found');
  }

  /** Guard for staff endpoints that should only touch tickets assigned to them (non-admin agents). */
  assertCanActOn(ticket: { assignedStaffId: string | null }, staffId: string, isAdmin: boolean) {
    if (!isAdmin && ticket.assignedStaffId && ticket.assignedStaffId !== staffId) {
      throw new ForbiddenException('Ticket is assigned to another agent');
    }
  }
}
