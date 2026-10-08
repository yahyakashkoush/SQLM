import { ConflictException } from '@nestjs/common';
import { Prisma, type WalletEntryType } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface LedgerMove {
  customerId: string;
  /** Positive. Whether it is a credit or a debit is the function's job. */
  amount: Prisma.Decimal;
  currency: string;
  type: WalletEntryType;
  orderId?: string;
  topUpId?: string;
  staffId?: string;
  note?: string;
}

export class InsufficientWalletBalanceError extends ConflictException {
  constructor(balance: Prisma.Decimal, needed: Prisma.Decimal, currency: string) {
    super({
      code: 'INSUFFICIENT_BALANCE',
      message: `رصيدك ${balance.toFixed(2)} ${currency} مش كفاية — المطلوب ${needed.toFixed(2)} ${currency}. اشحن رصيدك الأول.`,
      balance: balance.toFixed(2),
      needed: needed.toFixed(2),
    });
  }
}

/**
 * The only two writes to `Customer.walletBalance`. Both must run inside the
 * caller's transaction so the balance and its ledger line commit together.
 *
 * A debit is one conditional UPDATE (`balance >= amount`): two purchases
 * racing for the last dollars cannot both win, and the database CHECK
 * constraint backs that up if a future code path forgets.
 */
export async function debitWallet(tx: Tx, move: LedgerMove) {
  assertPositive(move.amount);
  const updated = await tx.customer.updateMany({
    where: { id: move.customerId, walletBalance: { gte: move.amount } },
    data: { walletBalance: { decrement: move.amount } },
  });
  if (updated.count === 0) {
    const current = await tx.customer.findUniqueOrThrow({
      where: { id: move.customerId },
      select: { walletBalance: true },
    });
    throw new InsufficientWalletBalanceError(current.walletBalance, move.amount, move.currency);
  }
  return writeEntry(tx, move, move.amount.neg());
}

export async function creditWallet(tx: Tx, move: LedgerMove) {
  assertPositive(move.amount);
  await tx.customer.update({
    where: { id: move.customerId },
    data: { walletBalance: { increment: move.amount } },
  });
  return writeEntry(tx, move, move.amount);
}

async function writeEntry(tx: Tx, move: LedgerMove, signed: Prisma.Decimal) {
  const { walletBalance } = await tx.customer.findUniqueOrThrow({
    where: { id: move.customerId },
    select: { walletBalance: true },
  });
  return tx.walletEntry.create({
    data: {
      customerId: move.customerId,
      type: move.type,
      amount: signed,
      balanceAfter: walletBalance,
      currency: move.currency,
      orderId: move.orderId,
      topUpId: move.topUpId,
      staffId: move.staffId,
      note: move.note,
    },
  });
}

function assertPositive(amount: Prisma.Decimal) {
  if (!amount.isFinite() || amount.lte(0))
    throw new Error(`Wallet move must be positive, got ${amount.toString()}`);
}
