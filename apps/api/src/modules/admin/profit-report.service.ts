import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
/** Money that came in and stayed. Refunded/cancelled orders are reported apart. */
const KEPT_STATUSES = [
  'PAID',
  'PROCESSING',
  'READY_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'DISPUTED',
] as const;

interface Bucket {
  revenue: Prisma.Decimal;
  cost: Prisma.Decimal;
  orders: number;
  units: number;
}

const zero = (): Bucket => ({
  revenue: new Prisma.Decimal(0),
  cost: new Prisma.Decimal(0),
  orders: 0,
  units: 0,
});
const money = (d: Prisma.Decimal) => d.toFixed(2);
const margin = (b: Bucket) =>
  b.revenue.gt(0) ? Number(b.revenue.sub(b.cost).div(b.revenue).mul(100).toFixed(1)) : null;
const out = (b: Bucket) => ({
  revenue: money(b.revenue),
  cost: money(b.cost),
  profit: money(b.revenue.sub(b.cost)),
  margin: margin(b),
  orders: b.orders,
  units: b.units,
});

/**
 * Revenue, cost and profit over a date range, by day, product, customer
 * and payment channel. Revenue is what was charged after discounts;
 * a line's share of an order discount is spread by its line total, so the
 * per-product numbers add up to the order totals. Cost is the cost price
 * frozen on each order line when it was sold.
 */
@Injectable()
export class ProfitReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async report(fromRaw?: string, toRaw?: string) {
    const { from, to } = this.range(fromRaw, toRaw);
    const currency = await this.settings.getString('store.defaultCurrency');
    const orders = await this.prisma.order.findMany({
      where: { paidAt: { gte: from, lt: to }, status: { in: [...KEPT_STATUSES] } },
      select: {
        id: true,
        currency: true,
        subtotal: true,
        total: true,
        paidAt: true,
        walletPaid: true,
        customerId: true,
        paymentMethod: { select: { name: true, provider: true } },
        customer: {
          select: { firstName: true, fullName: true, telegramUsername: true, wholesaleAt: true },
        },
        items: {
          select: {
            productId: true,
            productNameSnapshot: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
            unitCost: true,
          },
        },
      },
    });

    const totals = zero();
    const days = new Map<string, Bucket>();
    const products = new Map<string, Bucket & { name: string }>();
    const customers = new Map<string, Bucket & { name: string; merchant: boolean }>();
    const channels = new Map<string, Bucket>();
    let otherCurrencyOrders = 0;
    let unitsWithoutCost = 0;

    for (const order of orders) {
      if (order.currency !== currency) {
        otherCurrencyOrders++;
        continue;
      }
      const day = order.paidAt!.toISOString().slice(0, 10);
      const channel = order.walletPaid
        ? 'Wallet'
        : order.paymentMethod
          ? order.paymentMethod.provider === 'MANUAL'
            ? order.paymentMethod.name
            : `Crypto (${order.paymentMethod.name})`
          : order.total.isZero()
            ? 'Gifts'
            : 'Other';
      // Share of the order discount each line carries.
      const ratio = order.subtotal.gt(0) ? order.total.div(order.subtotal) : new Prisma.Decimal(0);
      let orderCost = new Prisma.Decimal(0);
      let orderUnits = 0;

      for (const item of order.items) {
        const gross = item.lineTotal ?? item.unitPrice.mul(item.quantity);
        const revenue = gross.mul(ratio);
        const cost = item.unitCost ? item.unitCost.mul(item.quantity) : new Prisma.Decimal(0);
        if (!item.unitCost) unitsWithoutCost += item.quantity;
        orderCost = orderCost.add(cost);
        orderUnits += item.quantity;
        const p = products.get(item.productId) ?? { ...zero(), name: item.productNameSnapshot };
        p.revenue = p.revenue.add(revenue);
        p.cost = p.cost.add(cost);
        p.units += item.quantity;
        p.orders++;
        products.set(item.productId, p);
      }

      const add = (b: Bucket) => {
        b.revenue = b.revenue.add(order.total);
        b.cost = b.cost.add(orderCost);
        b.orders++;
        b.units += orderUnits;
      };
      add(totals);
      add(days.get(day) ?? days.set(day, zero()).get(day)!);
      add(channels.get(channel) ?? channels.set(channel, zero()).get(channel)!);
      const name =
        order.customer.fullName ||
        order.customer.firstName ||
        (order.customer.telegramUsername ? `@${order.customer.telegramUsername}` : 'Customer');
      const c = customers.get(order.customerId) ?? {
        ...zero(),
        name,
        merchant: order.customer.wholesaleAt !== null,
      };
      add(c);
      customers.set(order.customerId, c);
    }

    const [refunds, walletFloat] = await Promise.all([
      this.prisma.order.aggregate({
        where: { updatedAt: { gte: from, lt: to }, status: 'REFUNDED', currency },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.customer.aggregate({ _sum: { walletBalance: true } }),
    ]);

    // Every day in the range, zeros included, so the chart has no gaps.
    const daily: Array<{ date: string } & ReturnType<typeof out>> = [];
    for (let t = from.getTime(); t < to.getTime(); t += DAY_MS) {
      const date = new Date(t).toISOString().slice(0, 10);
      daily.push({ date, ...out(days.get(date) ?? zero()) });
    }

    const totalUnits = totals.units || 1;
    return {
      currency,
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        ...out(totals),
        averageOrder: totals.orders ? money(totals.revenue.div(totals.orders)) : '0.00',
        refunds: {
          count: refunds._count,
          amount: money(refunds._sum.total ?? new Prisma.Decimal(0)),
        },
        /** Share of units sold with a known cost — profit is only as good as this. */
        costCoverage: Math.round(((totalUnits - unitsWithoutCost) / totalUnits) * 100),
        otherCurrencyOrders,
        /** Merchants' prepaid balances: money received but not yet sold against. */
        walletLiability: money(walletFloat._sum.walletBalance ?? new Prisma.Decimal(0)),
      },
      daily,
      products: [...products.entries()]
        .map(([id, b]) => ({ id, name: b.name, ...out(b) }))
        .sort((a, b) => Number(b.profit) - Number(a.profit))
        .slice(0, 25),
      customers: [...customers.entries()]
        .map(([id, b]) => ({ id, name: b.name, merchant: b.merchant, ...out(b) }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue))
        .slice(0, 10),
      channels: [...channels.entries()]
        .map(([name, b]) => ({ name, ...out(b) }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue)),
    };
  }

  /** Whole UTC days; `to` is inclusive for the caller and exclusive here. */
  private range(fromRaw?: string, toRaw?: string) {
    const parse = (v: string | undefined) =>
      v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const to = new Date((parse(toRaw) ?? today).getTime() + DAY_MS);
    const from = parse(fromRaw) ?? new Date(to.getTime() - 30 * DAY_MS);
    if (from >= to) throw new BadRequestException('from must be before to');
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(`Pick a range of at most ${MAX_RANGE_DAYS} days`);
    }
    return { from, to };
  }
}
