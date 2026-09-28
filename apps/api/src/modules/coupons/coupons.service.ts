import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Coupon } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CouponNotUsableError } from './errors/coupon.errors';
import type { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

type PrismaTx = Prisma.TransactionClient;

export interface CouponQuote {
  couponId: string;
  code: string;
  /** What comes off this subtotal, already rounded and capped. */
  discount: Prisma.Decimal;
}

/** Money is 2dp everywhere in this schema; a discount that is not would
 *  make `subtotal - discount` disagree with the stored total. */
const MONEY_DP = 2;

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prices a code against a subtotal without spending it.
   *
   * The same function backs the "apply" button in the Mini App and the
   * checkout that actually charges, so a customer is never quoted one
   * discount and charged another.
   *
   * Throws rather than returning null: every rejection has a reason the
   * customer needs to read ("expired", "minimum is $10"), and a bare null
   * would throw that away.
   */
  async quote(
    code: string,
    customerId: string,
    subtotal: Prisma.Decimal,
    tx: PrismaTx | PrismaService = this.prisma,
  ): Promise<CouponQuote> {
    const normalized = normalizeCode(code);
    const coupon = await tx.coupon.findUnique({ where: { code: normalized } });
    if (!coupon) throw new CouponNotUsableError('كود الخصم ده مش موجود.');

    assertWindowOpen(coupon);

    if (coupon.minSubtotal && subtotal.lessThan(coupon.minSubtotal)) {
      throw new CouponNotUsableError(
        `الكود ده بيشتغل على طلبات ${coupon.minSubtotal.toString()} فأكتر.`,
      );
    }

    if (coupon.maxRedemptions !== null && coupon.timesRedeemed >= coupon.maxRedemptions) {
      throw new CouponNotUsableError('الكود ده خلص عدد مرات استخدامه.');
    }

    const usedByCustomer = await tx.couponRedemption.count({
      where: { couponId: coupon.id, customerId },
    });
    if (usedByCustomer >= coupon.perCustomerLimit) {
      throw new CouponNotUsableError('إنت استخدمت الكود ده قبل كده.');
    }

    const discount = computeDiscount(coupon, subtotal);
    if (discount.lessThanOrEqualTo(0)) {
      throw new CouponNotUsableError('الكود ده مش هيخصم حاجة على الطلب ده.');
    }

    return { couponId: coupon.id, code: coupon.code, discount };
  }

  /**
   * Spends a quoted coupon against an order, inside the checkout's own
   * transaction so the discount and the order it paid for commit together.
   *
   * Both caps are enforced by the database, not by the reads above:
   * the global one by a conditional UPDATE that only moves when there is
   * headroom, the per-customer one by the unique index on the redemption
   * ordinal. Two simultaneous checkouts racing the last use of a code
   * leave exactly one winner, and the loser is told the code is spent
   * rather than quietly getting it free.
   */
  async redeem(
    tx: PrismaTx,
    quote: CouponQuote,
    customerId: string,
    orderId: string,
  ): Promise<void> {
    const moved = await tx.$executeRaw`
      UPDATE "coupons"
         SET "timesRedeemed" = "timesRedeemed" + 1
       WHERE "id" = ${quote.couponId}
         AND ("maxRedemptions" IS NULL OR "timesRedeemed" < "maxRedemptions")
    `;
    if (moved === 0) {
      throw new CouponNotUsableError('الكود ده خلص عدد مرات استخدامه.');
    }

    const used = await tx.couponRedemption.count({
      where: { couponId: quote.couponId, customerId },
    });

    try {
      await tx.couponRedemption.create({
        data: {
          couponId: quote.couponId,
          customerId,
          orderId,
          amount: quote.discount,
          customerSeq: used + 1,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Another checkout by this same customer took the ordinal first.
        throw new CouponNotUsableError('إنت استخدمت الكود ده قبل كده.');
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async listAdmin() {
    const coupons = await this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    return coupons.map(toAdminView);
  }

  async createAdmin(dto: CreateCouponDto) {
    assertValueSane(dto.type, dto.value);
    const coupon = await this.prisma.coupon.create({
      data: { ...dto, code: normalizeCode(dto.code) },
    });
    return toAdminView(coupon);
  }

  async updateAdmin(id: string, dto: UpdateCouponDto) {
    const current = await this.prisma.coupon.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Coupon not found');

    // A partial update can change the type without the value, or the
    // other way round, so both are checked against the merged result.
    assertValueSane(dto.type ?? current.type, dto.value ?? Number(current.value));

    const coupon = await this.prisma.coupon.update({
      where: { id },
      data: { ...dto, ...(dto.code ? { code: normalizeCode(dto.code) } : {}) },
    });
    return toAdminView(coupon);
  }

  /** Never deleted — orders reference the coupon that priced them. */
  async deactivateAdmin(id: string) {
    const current = await this.prisma.coupon.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Coupon not found');
    const coupon = await this.prisma.coupon.update({ where: { id }, data: { active: false } });
    return toAdminView(coupon);
  }
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function assertWindowOpen(coupon: Coupon): void {
  if (!coupon.active) throw new CouponNotUsableError('الكود ده موقوف.');
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) {
    throw new CouponNotUsableError('الكود ده لسه مبدأش.');
  }
  if (coupon.endsAt && coupon.endsAt < now) {
    throw new CouponNotUsableError('الكود ده انتهت صلاحيته.');
  }
}

/**
 * Never more than the subtotal: a fixed-amount coupon larger than the cart
 * would otherwise produce a negative total, and the customer would be owed
 * money by a store that has no way to pay it.
 */
function computeDiscount(coupon: Coupon, subtotal: Prisma.Decimal): Prisma.Decimal {
  const raw =
    coupon.type === 'PERCENT'
      ? subtotal.mul(coupon.value).div(100)
      : new Prisma.Decimal(coupon.value);

  const capped =
    coupon.type === 'PERCENT' && coupon.maxDiscount && raw.greaterThan(coupon.maxDiscount)
      ? new Prisma.Decimal(coupon.maxDiscount)
      : raw;

  // Round in the customer's favour, then clamp to the subtotal.
  const rounded = capped.toDecimalPlaces(MONEY_DP, Prisma.Decimal.ROUND_DOWN);
  return rounded.greaterThan(subtotal) ? subtotal : rounded;
}

function assertValueSane(type: 'PERCENT' | 'FIXED', value: number): void {
  if (value <= 0) throw new CouponNotUsableError('قيمة الخصم لازم تكون أكبر من صفر.');
  if (type === 'PERCENT' && value > 100) {
    throw new CouponNotUsableError('نسبة الخصم مينفعش تزيد عن ١٠٠٪.');
  }
}

function toAdminView(coupon: Coupon) {
  return {
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    value: coupon.value.toString(),
    minSubtotal: coupon.minSubtotal?.toString() ?? null,
    maxDiscount: coupon.maxDiscount?.toString() ?? null,
    maxRedemptions: coupon.maxRedemptions,
    perCustomerLimit: coupon.perCustomerLimit,
    startsAt: coupon.startsAt,
    endsAt: coupon.endsAt,
    active: coupon.active,
    timesRedeemed: coupon.timesRedeemed,
    createdAt: coupon.createdAt,
  };
}
