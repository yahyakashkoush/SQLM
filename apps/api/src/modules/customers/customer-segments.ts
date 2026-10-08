import type { Prisma } from '@prisma/client';
import { DORMANT_AFTER_DAYS, type CustomerSegment } from '@sqlm/shared';

/** An order counts as bought once it has been paid, whatever happened after. */
const PAID: Prisma.OrderWhereInput = { paidAt: { not: null } };

/**
 * The query behind each audience in `CUSTOMER_SEGMENTS`. Broadcasts and
 * the customers list both go through here, so "Buyers" in the picker and
 * "Buyers" in the filter are the same people by construction.
 *
 * Only ever active customers: a blocked customer is not an audience.
 */
export function segmentWhere(segment: CustomerSegment = 'ALL', now = new Date()): Prisma.CustomerWhereInput {
  const active: Prisma.CustomerWhereInput = { status: 'ACTIVE' };
  switch (segment) {
    case 'ALL':
      return active;
    case 'VERIFIED':
      return { ...active, verifiedAt: { not: null } };
    case 'REGULAR':
      return { ...active, verifiedAt: null };
    case 'BUYERS':
      return { ...active, orders: { some: PAID } };
    case 'NON_BUYERS':
      return { ...active, orders: { none: PAID } };
    case 'WHOLESALE':
      return { ...active, wholesaleAt: { not: null } };
    case 'DORMANT': {
      const since = new Date(now.getTime() - DORMANT_AFTER_DAYS * 24 * 60 * 60 * 1000);
      return {
        ...active,
        AND: [{ orders: { some: PAID } }, { orders: { none: { paidAt: { gte: since } } } }],
      };
    }
  }
}
