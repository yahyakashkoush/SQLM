import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OrderStatus } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoWatchService } from '../crypto-payments/crypto-watch.service';
import { OrdersService } from './orders.service';

/** Orders a banned customer could still pay for, or trick staff into approving. */
const OPEN_UNPAID: readonly OrderStatus[] = ['CREATED', 'PENDING_PAYMENT', 'PAYMENT_SUBMITTED', 'PAYMENT_REVIEW'];

export interface BanResult {
  customerId: string;
  cancelledOrders: number;
}

/**
 * Banning is more than a status flag: a scammer's unpaid orders hold stock
 * and a pending proof is a fake payment waiting for a tired reviewer to
 * approve it. So a ban also rejects their pending proofs and cancels
 * every order that has not been paid. Paid orders are left alone — money
 * that really arrived is a support conversation, not an automatic undo.
 *
 * Enforcement lives elsewhere: the bot ignores a banned sender, and the
 * Mini App's login and every authenticated request refuse a non-ACTIVE
 * customer.
 */
@Injectable()
export class CustomerModerationService {
  private readonly logger = new Logger(CustomerModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly cryptoWatch: CryptoWatchService,
    private readonly audit: AuditService,
  ) {}

  /** `staffId` null = the strike ladder banned the account on its own. */
  async ban(customerId: string, staffId: string | null, reason: string): Promise<BanResult> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    const why = reason.trim().slice(0, 300) || 'مخالفة شروط الاستخدام';

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { status: 'BANNED', bannedAt: new Date(), banReason: why },
    });

    const open = await this.prisma.order.findMany({
      where: { customerId, status: { in: [...OPEN_UNPAID] } },
      select: { id: true },
    });
    let cancelledOrders = 0;
    for (const { id } of open) {
      try {
        await this.cryptoWatch.cancelForOrder(id);
        await this.prisma.$transaction(async (tx) => {
          await tx.paymentProof.updateMany({
            where: { orderId: id, status: 'PENDING' },
            data: { status: 'REJECTED', rejectionReason: why, reviewedById: staffId, reviewedAt: new Date() },
          });
          await this.orders.transition(
            tx,
            id,
            'CANCELLED',
            staffId ? { type: 'STAFF', staffId } : { type: 'SYSTEM' },
            `تم إيقاف الحساب: ${why}`,
          );
        });
        cancelledOrders++;
      } catch (err) {
        // Someone approved or cancelled it in the meantime; the ban itself stands.
        this.logger.warn(`Ban of ${customerId}: could not cancel order ${id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    await this.audit.log({
      actorStaffId: staffId ?? undefined,
      action: staffId ? 'customer.banned' : 'customer.auto_banned',
      entityType: 'customer',
      entityId: customerId,
      changes: { reason: why, cancelledOrders },
    });
    return { customerId, cancelledOrders };
  }

  async unban(customerId: string, staffId: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { status: 'ACTIVE', bannedAt: null, banReason: null, suspendedUntil: null, suspendReason: null },
    });
    await this.audit.log({
      actorStaffId: staffId,
      action: 'customer.unbanned',
      entityType: 'customer',
      entityId: customerId,
    });
  }
}
