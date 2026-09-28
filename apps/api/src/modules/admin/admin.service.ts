import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import type { OrderStatus, Role } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import type {
  AuditLogQueryDto,
  CreateStaffDto,
  CustomerQueryDto,
  UpdateSettingDto,
  UpdateStaffDto,
} from './dto/admin.dto';

/**
 * Statuses whose money is really the store's. PAID is the earliest point a
 * payment is confirmed; REFUNDED and CANCELLED are deliberately absent, so
 * a refund removes an order from revenue instead of inflating it forever.
 */
const REVENUE_STATUSES: OrderStatus[] = [
  'PAID',
  'PROCESSING',
  'READY_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
];

/** Operational read/write surface the dashboard needs that no domain module owns. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Revenue over a window, plus the same window a period earlier.
   *
   * A single all-time total — which is all `stats()` had — cannot answer
   * the only question an operator actually asks: is the store doing better
   * than it was? Returning the previous period alongside makes the number
   * comparable without the dashboard having to make a second call and do
   * date arithmetic of its own.
   */
  async revenueReport(days = 30) {
    const bounded = Math.min(Math.max(Math.trunc(days), 1), 365);
    const now = new Date();
    const windowMs = bounded * 24 * 60 * 60 * 1000;
    const from = new Date(now.getTime() - windowMs);
    const previousFrom = new Date(from.getTime() - windowMs);

    // `paidAt` rather than `createdAt`: an order that was placed last month
    // and paid today is this period's money.
    const paid: Prisma.OrderWhereInput = { status: { in: REVENUE_STATUSES } };

    const [current, previous, byDay, topProducts] = await this.prisma.$transaction([
      this.prisma.order.aggregate({
        _sum: { total: true, discountTotal: true },
        _count: true,
        where: { ...paid, paidAt: { gte: from, lte: now } },
      }),
      this.prisma.order.aggregate({
        _sum: { total: true },
        _count: true,
        where: { ...paid, paidAt: { gte: previousFrom, lt: from } },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; revenue: Prisma.Decimal; orders: bigint }>>`
        SELECT date_trunc('day', "paidAt") AS day,
               SUM("total")                AS revenue,
               COUNT(*)                    AS orders
          FROM "orders"
         WHERE "paidAt" >= ${from}
           AND "paidAt" <= ${now}
           AND "status" = ANY(${REVENUE_STATUSES}::"OrderStatus"[])
         GROUP BY 1
         ORDER BY 1
      `,
      this.prisma.$queryRaw<
        Array<{ productId: string; name: string; units: bigint; revenue: Prisma.Decimal }>
      >`
        SELECT oi."productId",
               oi."productNameSnapshot" AS name,
               SUM(oi."quantity")                     AS units,
               SUM(oi."unitPrice" * oi."quantity")    AS revenue
          FROM "order_items" oi
          JOIN "orders" o ON o."id" = oi."orderId"
         WHERE o."paidAt" >= ${from}
           AND o."paidAt" <= ${now}
           AND o."status" = ANY(${REVENUE_STATUSES}::"OrderStatus"[])
         GROUP BY 1, 2
         ORDER BY revenue DESC
         LIMIT 5
      `,
    ]);

    const revenue = current._sum.total ?? new Prisma.Decimal(0);
    const previousRevenue = previous._sum.total ?? new Prisma.Decimal(0);

    return {
      days: bounded,
      from,
      to: now,
      revenue: revenue.toString(),
      orders: current._count,
      discountsGiven: (current._sum.discountTotal ?? new Prisma.Decimal(0)).toString(),
      averageOrderValue:
        current._count > 0 ? revenue.div(current._count).toDecimalPlaces(2).toString() : '0',
      previous: { revenue: previousRevenue.toString(), orders: previous._count },
      /** Null when there is nothing to compare against, rather than a
       *  meaningless +100% out of a zero baseline. */
      changePercent: previousRevenue.isZero()
        ? null
        : revenue.sub(previousRevenue).div(previousRevenue).mul(100).toDecimalPlaces(1).toNumber(),
      byDay: byDay.map((row) => ({
        day: row.day,
        revenue: row.revenue.toString(),
        orders: Number(row.orders),
      })),
      topProducts: topProducts.map((row) => ({
        productId: row.productId,
        name: row.name,
        units: Number(row.units),
        revenue: row.revenue.toString(),
      })),
    };
  }

  /** Single round-trip for the dashboard landing page. */
  async stats() {
    const [
      ordersByStatus,
      pendingProofs,
      pendingDeliveries,
      openTickets,
      unreadTickets,
      lowStockProducts,
      revenue,
      customers,
    ] = await this.prisma.$transaction([
      this.prisma.order.groupBy({ by: ['status'], _count: true, orderBy: undefined }),
      this.prisma.paymentProof.count({ where: { status: 'PENDING' } }),
      this.prisma.delivery.count({ where: { method: 'MANUAL', status: { not: 'DELIVERED' } } }),
      this.prisma.supportTicket.count({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      this.prisma.supportTicket.aggregate({ _sum: { staffUnread: true } }),
      this.prisma.product.count({ where: { status: 'ACTIVE', inventoryMode: 'QUANTITY', stock: { lte: 3 } } }),
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: { status: { in: REVENUE_STATUSES } },
      }),
      this.prisma.customer.count(),
    ]);

    return {
      ordersByStatus: Object.fromEntries(ordersByStatus.map((r) => [r.status, r._count])),
      pendingProofs,
      pendingDeliveries,
      openTickets,
      unreadTickets: unreadTickets._sum.staffUnread ?? 0,
      lowStockProducts,
      revenue: revenue._sum.total?.toString() ?? '0',
      customers,
    };
  }

  async listCustomers(query: CustomerQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CustomerWhereInput = query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { telegramUsername: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          telegramUsername: true,
          status: true,
          createdAt: true,
          _count: { select: { orders: true, supportTickets: true } },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async getCustomer(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        telegramUsername: true,
        status: true,
        createdAt: true,
        orders: {
          select: { id: true, sequenceNumber: true, status: true, total: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        supportTickets: {
          select: { id: true, ticketNumber: true, subject: true, status: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async listStaff() {
    return this.prisma.staff.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createStaff(dto: CreateStaffDto, actorStaffId: string) {
    const existing = await this.prisma.staff.findUnique({ where: { email: dto.email } });
    if (existing) throw new BadRequestException('A staff account with that email already exists');

    const staff = await this.prisma.staff.create({
      data: {
        email: dto.email,
        name: dto.name,
        role: dto.role as Role,
        passwordHash: await argon2.hash(dto.password),
        status: 'ACTIVE',
      },
      select: { id: true, email: true, name: true, role: true, status: true },
    });

    await this.audit.log({
      actorStaffId,
      action: 'staff.create',
      entityType: 'Staff',
      entityId: staff.id,
      changes: { email: dto.email, role: dto.role },
    });
    return staff;
  }

  async updateStaff(id: string, dto: UpdateStaffDto, actorStaffId: string) {
    const staff = await this.prisma.staff.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException('Staff not found');

    // The last active OWNER must stay an active OWNER, or nobody can
    // administer the platform again.
    if (staff.role === 'OWNER' && (dto.role !== undefined || dto.status === 'DISABLED')) {
      const owners = await this.prisma.staff.count({ where: { role: 'OWNER', status: 'ACTIVE' } });
      if (owners <= 1) throw new BadRequestException('Cannot demote or suspend the last active owner');
    }

    const updated = await this.prisma.staff.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.role !== undefined ? { role: dto.role as Role } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.password ? { passwordHash: await argon2.hash(dto.password) } : {}),
      },
      select: { id: true, email: true, name: true, role: true, status: true },
    });

    await this.audit.log({
      actorStaffId,
      action: 'staff.update',
      entityType: 'Staff',
      entityId: id,
      changes: { ...dto, password: dto.password ? '[changed]' : undefined },
    });
    return updated;
  }

  async listAuditLogs(query: AuditLogQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { actorStaff: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async listSettings() {
    return this.settings.listForAdmin();
  }

  async updateSetting(key: string, dto: UpdateSettingDto, actorStaffId: string) {
    const setting = await this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: dto.value as never, updatedByStaffId: actorStaffId },
      update: { value: dto.value as never, updatedByStaffId: actorStaffId },
    });
    this.settings.invalidate();

    await this.audit.log({
      actorStaffId,
      action: 'settings.update',
      entityType: 'PlatformSetting',
      entityId: key,
      changes: { value: dto.value },
    });
    return setting;
  }
}
