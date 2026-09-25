/**
 * Product/payment-method currencies are admin-defined free text (crypto
 * tickers like "USDT" included), not guaranteed valid ISO 4217 codes that
 * Intl.NumberFormat accepts — fall back to a plain "<amount> <code>" render
 * instead of throwing.
 */
export function formatMoney(amount: string | number, currency: string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
