import { randomBytes } from 'node:crypto';

/** ASCII slug from a display name; names with no Latin characters (e.g. Arabic) get a random one. */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || `item-${randomBytes(3).toString('hex')}`;
}

/** First of `base`, `base-2`, `base-3`, ... that `isTaken` rejects. */
export async function uniqueSlug(base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  let candidate = base;
  for (let i = 2; await isTaken(candidate); i++) {
    candidate = i > 20 ? `${base}-${randomBytes(3).toString('hex')}` : `${base}-${i}`;
  }
  return candidate;
}
