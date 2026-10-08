/** Egypt: the store's home market, and the default for numbers written the local way. */
const DEFAULT_COUNTRY_CODE = '20';

/**
 * One canonical form for a phone number, digits only, international:
 * "0101 234 5678", "+20 101 234 5678", "00201012345678" and Telegram's
 * "201012345678" are all "201012345678". Returns null for anything that
 * is not plausibly a phone number, so junk lines in a pasted list are
 * reported instead of stored.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (/^0\d{9,10}$/.test(digits)) digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  else if (/^1\d{9}$/.test(digits)) digits = DEFAULT_COUNTRY_CODE + digits;
  digits = digits.replace(/\D/g, '');
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

/** "201012345678" → "+20 101 234 5678"-ish, masked for anyone but the owner. */
export function maskPhone(phone: string): string {
  return phone.length > 6 ? `+${phone.slice(0, -6)}••••${phone.slice(-2)}` : phone;
}
