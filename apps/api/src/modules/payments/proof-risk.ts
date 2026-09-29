import type { PrismaService } from '../prisma/prisma.service';

/** Under a day old and never paid: the profile of most fake-receipt attempts. */
const NEW_ACCOUNT_HOURS = 24;

export interface ProofRisk {
  /** Other orders where this exact file was submitted before. */
  duplicates: { orderId: string; sequenceNumber: number; sameCustomer: boolean }[];
  /** This customer's rejected proofs, on any order. */
  previousRejections: number;
  paidOrders: number;
  accountAgeHours: number;
  /** Arabic one-liners for the reviewer, most serious first. Empty = nothing suspicious. */
  flags: string[];
}

/**
 * What a reviewer should know before approving a payment screenshot. The
 * strongest signal is a reused file: a screenshot is only ever proof of
 * one transfer, so the same bytes on a second order are a copy.
 */
export async function assessProofRisk(
  prisma: PrismaService,
  proof: { id: string; orderId: string; customerId: string; contentHash: string | null },
): Promise<ProofRisk> {
  const [duplicates, previousRejections, paidOrders, customer] = await Promise.all([
    proof.contentHash
      ? prisma.paymentProof.findMany({
          where: { contentHash: proof.contentHash, id: { not: proof.id }, orderId: { not: proof.orderId } },
          select: { orderId: true, customerId: true, order: { select: { sequenceNumber: true } } },
          orderBy: { uploadedAt: 'asc' },
          take: 5,
        })
      : Promise.resolve([]),
    prisma.paymentProof.count({ where: { customerId: proof.customerId, status: 'REJECTED' } }),
    prisma.order.count({ where: { customerId: proof.customerId, paidAt: { not: null } } }),
    prisma.customer.findUnique({ where: { id: proof.customerId }, select: { createdAt: true } }),
  ]);

  const accountAgeHours = customer ? (Date.now() - customer.createdAt.getTime()) / 3_600_000 : 0;
  const flags: string[] = [];
  for (const d of duplicates) {
    flags.push(
      `🚨 نفس صورة الإيصال اتبعتت قبل كده في طلب #${d.order.sequenceNumber}` +
        (d.customerId === proof.customerId ? ' (من نفس العميل)' : ' (من عميل تاني!)'),
    );
  }
  if (previousRejections > 0) flags.push(`⚠️ العميل ده اترفضله ${previousRejections} إيصال قبل كده`);
  if (paidOrders === 0 && accountAgeHours < NEW_ACCOUNT_HOURS) {
    flags.push('🆕 حساب جديد وأول طلب — طابق المبلغ مع كشف الحساب قبل القبول');
  }

  return {
    duplicates: duplicates.map((d) => ({
      orderId: d.orderId,
      sequenceNumber: d.order.sequenceNumber,
      sameCustomer: d.customerId === proof.customerId,
    })),
    previousRejections,
    paidOrders,
    accountAgeHours: Math.round(accountAgeHours),
    flags,
  };
}
