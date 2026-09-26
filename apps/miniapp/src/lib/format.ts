/** Currencies are admin-defined free text; known codes get their Arabic symbol, others print as-is. */
const CURRENCY_AR: Record<string, string> = { EGP: 'ج.م', USD: '$', SAR: 'ر.س', AED: 'د.إ', KWD: 'د.ك', EUR: '€' };

export function formatMoney(amount: string | number, currency: string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  const number = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${number} ${CURRENCY_AR[currency] ?? currency}`;
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}
