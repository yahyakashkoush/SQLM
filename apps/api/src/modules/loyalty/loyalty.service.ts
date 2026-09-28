import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type MemberDiscountKind } from '@prisma/client';
import { renderTemplate } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

type PrismaTx = Prisma.TransactionClient;

export interface MemberDiscount {
  kind: MemberDiscountKind;
  percent: number;
}

/** Money is 2dp everywhere in this schema. */
const MONEY_DP = 2;

/**
 * Customer tiers, in one place.
 *
 * A customer is *regular* until their first order is paid and *verified*
 * (مميز وموثّق) from then on. Regular customers get a one-time welcome gift
 * on their first order; verified ones get a standing discount on every
 * order. Both are percentages from Settings, and both are applied by the
 * server at pricing time — never taken from the client.
 */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Which member discount a customer is entitled to right now, if any.
   *
   * The welcome gift counts as available only while no other order holds
   * it: a customer with an unpaid gifted order cannot open a second one
   * for another discount, and gets the gift back if they cancel.
   */
  async memberDiscountFor(customerId: string, db: PrismaTx | PrismaService = this.prisma): Promise<MemberDiscount | null> {
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: { verifiedAt: true, welcomeGiftOrderId: true },
    });
    if (!customer) return null;

    if (customer.verifiedAt) {
      const percent = await this.settings.getNumber('customers.verifiedDiscountPercent', db);
      return percent > 0 ? { kind: 'VERIFIED', percent } : null;
    }
    if (customer.welcomeGiftOrderId) return null;
    const percent = await this.settings.getNumber('customers.welcomeGiftPercent', db);
    return percent > 0 ? { kind: 'WELCOME', percent } : null;
  }

  /** Rounded down in the customer's favour and never more than the amount. */
  static amountOff(discount: MemberDiscount, amount: Prisma.Decimal): Prisma.Decimal {
    const raw = amount.mul(discount.percent).div(100).toDecimalPlaces(MONEY_DP, Prisma.Decimal.ROUND_DOWN);
    return raw.greaterThan(amount) ? amount : raw;
  }

  /**
   * Takes the welcome gift for an order, inside the checkout transaction.
   *
   * Conditional on the gift still being free and the customer still being
   * regular, so of two simultaneous first orders exactly one gets it. The
   * caller must fail the checkout on `false`: the customer was quoted a
   * price with the gift in it, and charging a different one silently is
   * not an option.
   */
  async claimWelcomeGift(tx: PrismaTx, customerId: string, orderId: string): Promise<boolean> {
    const claimed = await tx.customer.updateMany({
      where: { id: customerId, welcomeGiftOrderId: null, verifiedAt: null },
      data: { welcomeGiftOrderId: orderId },
    });
    return claimed.count === 1;
  }

  /** A cancelled order hands the gift back. A no-op for any other order. */
  async releaseWelcomeGift(tx: PrismaTx, orderId: string): Promise<void> {
    await tx.customer.updateMany({
      where: { welcomeGiftOrderId: orderId },
      data: { welcomeGiftOrderId: null },
    });
  }

  /**
   * Called by the order state machine on every transition to PAID.
   * Returns true only for the payment that actually verified the
   * customer, so they are congratulated once and not on every order.
   */
  async verifyOnPayment(tx: PrismaTx, customerId: string): Promise<boolean> {
    const result = await tx.customer.updateMany({
      where: { id: customerId, verifiedAt: null },
      data: { verifiedAt: new Date() },
    });
    return result.count === 1;
  }

  /** The Telegram message for a customer who just became verified. */
  async verifiedMessage(customerName: string | null, db?: PrismaTx): Promise<string> {
    const [template, store, percent] = await Promise.all([
      this.settings.getString('customers.verifiedMessage', db),
      this.settings.storeValues(db),
      this.settings.getNumber('customers.verifiedDiscountPercent', db),
    ]);
    return renderTemplate(template, { ...store, percent, customer_name: customerName ?? '' });
  }

  /** What the Mini App shows on the home and account pages. */
  async perksFor(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { verifiedAt: true, welcomeGiftOrderId: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const [verifiedPercent, giftPercent, giftTemplate, store] = await Promise.all([
      this.settings.getNumber('customers.verifiedDiscountPercent'),
      this.settings.getNumber('customers.welcomeGiftPercent'),
      this.settings.getString('customers.welcomeGiftMessage'),
      this.settings.storeValues(),
    ]);

    const verified = customer.verifiedAt !== null;
    return {
      tier: verified ? ('VERIFIED' as const) : ('REGULAR' as const),
      verifiedAt: customer.verifiedAt,
      /** The standing discount a verified customer has, or would have. */
      verifiedDiscountPercent: verifiedPercent,
      welcomeGift:
        !verified && giftPercent > 0
          ? {
              percent: giftPercent,
              /** False while an unpaid order is holding it. */
              available: customer.welcomeGiftOrderId === null,
              message: renderTemplate(giftTemplate, { ...store, percent: giftPercent }),
            }
          : null,
    };
  }

  /** Staff override: grant or revoke verified status by hand. */
  async setVerified(customerId: string, verified: boolean) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { verifiedAt: verified ? new Date() : null },
      select: { id: true, verifiedAt: true },
    });
  }
}
