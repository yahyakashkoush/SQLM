import { Prisma } from '@prisma/client';

export interface PaymentConversion {
  currency: string;
  amount: Prisma.Decimal;
  /** Units of `currency` per one unit of the order currency. */
  rate: Prisma.Decimal;
}

/**
 * Stablecoins are dollars for pricing purposes: a USDT method charging a
 * USD order needs no conversion.
 */
const CURRENCY_ALIASES: Record<string, string> = { USDT: 'USD', USDC: 'USD' };

function canonical(code: string): string {
  const upper = code.trim().toUpperCase();
  return CURRENCY_ALIASES[upper] ?? upper;
}

/**
 * What a customer transfers when the payment method's currency differs
 * from the order's — USD prices paid through Vodafone Cash or InstaPay.
 *
 * Only USD↔EGP is known, at the admin's rate. Anything else returns null
 * and the order is paid in its own currency, which is what happened before
 * conversion existed, so an unknown pair can only ever be shown the plain
 * price — never a made-up one.
 *
 * EGP is rounded up to a whole pound: nobody sends piastres by wallet or
 * InstaPay, and rounding down would leave every such order a few piastres
 * short. USD is rounded up to the cent for the same reason.
 */
export function convertForPayment(
  total: Prisma.Decimal,
  orderCurrency: string,
  methodCurrency: string,
  egpPerUsd: number,
): PaymentConversion | null {
  const from = canonical(orderCurrency);
  const to = canonical(methodCurrency);
  if (from === to || !(egpPerUsd > 0)) return null;

  const rate = new Prisma.Decimal(egpPerUsd);
  if (from === 'USD' && to === 'EGP') {
    return {
      currency: 'EGP',
      amount: total.mul(rate).toDecimalPlaces(0, Prisma.Decimal.ROUND_UP),
      rate,
    };
  }
  if (from === 'EGP' && to === 'USD') {
    const inverse = new Prisma.Decimal(1).div(rate);
    return {
      currency: 'USD',
      amount: total.div(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_UP),
      rate: inverse.toDecimalPlaces(6),
    };
  }
  return null;
}
