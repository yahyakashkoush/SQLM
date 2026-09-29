import { Injectable } from '@nestjs/common';
import { Prisma, type MemberDiscountKind, type PaymentMethod, type Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CouponsService, type CouponQuote } from '../coupons/coupons.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ProductNotPurchasableError } from './errors/order.errors';
import { convertForPayment, type PaymentConversion } from './payment-currency';

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface PricedCart {
  currency: string;
  subtotal: Prisma.Decimal;
  productById: Map<string, Product>;
}

/**
 * Turns a list of product ids and quantities into money, from the database
 * every time.
 *
 * Extracted from checkout so the coupon quote endpoint prices the identical
 * cart the identical way. A subtotal posted by the client is a number the
 * client can edit, and quoting a percentage against it would let anyone
 * claim any discount they liked; both paths going through here is what
 * makes the quoted total and the charged total the same number.
 */
export interface OrderQuote extends PricedCart {
  /** The verified discount or the welcome gift, taken off first. */
  member: { kind: MemberDiscountKind; percent: number; amount: Prisma.Decimal } | null;
  /** Priced against the subtotal after the member discount. */
  coupon: CouponQuote | null;
  /** member + coupon, so `total = subtotal - discountTotal` always holds. */
  discountTotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

@Injectable()
export class CartPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly coupons: CouponsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  /**
   * The full price of a cart for one customer: subtotal, their member
   * discount, an optional coupon, and the total.
   *
   * The quote endpoint and checkout both call this, which is what makes
   * "the price you were shown" and "the price you are charged" the same
   * function rather than two that are supposed to agree. Order of
   * application is fixed: member discount on the subtotal, then the coupon
   * on what is left, so stacking can never take more than the cart is
   * worth.
   */
  async quote(customerId: string, items: CartLine[], couponCode?: string): Promise<OrderQuote> {
    const cart = await this.priceCart(items);

    const entitlement = await this.loyalty.memberDiscountFor(customerId);
    const member = entitlement
      ? { ...entitlement, amount: LoyaltyService.amountOff(entitlement, cart.subtotal) }
      : null;
    const afterMember = cart.subtotal.sub(member?.amount ?? 0);

    const coupon = couponCode?.trim()
      ? await this.coupons.quote(couponCode, customerId, afterMember)
      : null;

    const discountTotal = (member?.amount ?? new Prisma.Decimal(0)).add(coupon?.discount ?? 0);
    return {
      ...cart,
      member: member && member.amount.greaterThan(0) ? member : null,
      coupon,
      discountTotal,
      total: cart.subtotal.sub(discountTotal),
    };
  }

  /** What the customer transfers with this method, or null if no conversion applies. */
  async conversionFor(
    total: Prisma.Decimal,
    orderCurrency: string,
    method: Pick<PaymentMethod, 'currency' | 'provider'>,
  ): Promise<PaymentConversion | null> {
    // An exchange method is paid in a dollar stablecoin whatever its
    // currency field says — the deposit watch expects that many coins. A
    // crypto method mislabelled "EGP" must never turn a $3 order into a
    // request for 150 USDT.
    const target = method.provider !== 'MANUAL' ? 'USD' : method.currency;
    const rate = await this.settings.getNumber('pricing.egpPerUsd');
    return convertForPayment(total, orderCurrency, target, rate);
  }

  async priceCart(items: CartLine[]): Promise<PricedCart> {
    if (items.length === 0) {
      throw new ProductNotPurchasableError('(empty cart)');
    }

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    const productById = new Map(products.map((p) => [p.id, p]));

    let currency: string | undefined;
    let subtotal = new Prisma.Decimal(0);

    for (const item of items) {
      const product = productById.get(item.productId);
      if (!product || product.status !== 'ACTIVE' || product.visibility !== 'VISIBLE') {
        throw new ProductNotPurchasableError(item.productId);
      }
      // One order, one currency: a mixed cart has no meaningful total.
      if (currency && currency !== product.currency) {
        throw new ProductNotPurchasableError(item.productId);
      }
      currency = product.currency;
      subtotal = subtotal.add(product.price.mul(item.quantity));
    }

    return { currency: currency!, subtotal, productById };
  }
}
