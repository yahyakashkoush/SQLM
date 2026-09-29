import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OrderStatus } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { InventoryService } from '../inventory/inventory.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { CouponsService } from '../coupons/coupons.service';

/** Stock is still held by these: deleting the order has to hand it back. */
const HOLDING_STOCK: readonly OrderStatus[] = ['CREATED', 'PENDING_PAYMENT', 'PAYMENT_SUBMITTED', 'PAYMENT_REVIEW'];
export const MAX_BULK_DELETE = 100;

export interface DeleteOrderResult {
  id: string;
  sequenceNumber: number;
  restocked: boolean;
}

/**
 * Permanent removal of an order — for test orders and junk, owner only.
 *
 * Everything the order touched is put back the way `cancel` would: a
 * reservation is released, the welcome gift and the coupon use are
 * returned. An order that was already cancelled released its stock at
 * that moment, so it is not released twice. A paid order's goods went to
 * someone, so they only return to stock when the owner explicitly asks
 * (`restock`) — the right call for a test purchase, the wrong one for a
 * real sale.
 */
@Injectable()
export class OrderCleanupService {
  private readonly logger = new Logger(OrderCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly loyalty: LoyaltyService,
    private readonly coupons: CouponsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async deleteOrder(orderId: string, staffId: string, restock = false): Promise<DeleteOrderResult> {
    const { result, proofKeys } = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: { select: { inventoryMode: true } } } },
          paymentProofs: { select: { storageKey: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      const status = order.status as OrderStatus;

      let restocked = false;
      if (HOLDING_STOCK.includes(status)) {
        await this.inventory.releaseIndividualItems(tx, orderId);
        for (const item of order.items) {
          if (item.product.inventoryMode === 'QUANTITY') {
            await this.inventory.releaseQuantity(tx, item.productId, item.quantity);
          }
        }
        restocked = true;
      } else if (status !== 'CANCELLED' && restock) {
        await tx.inventoryItem.updateMany({
          where: { orderId },
          data: { status: 'AVAILABLE', reservedAt: null, soldAt: null, deliveredAt: null, orderId: null },
        });
        for (const item of order.items) {
          if (item.product.inventoryMode === 'QUANTITY') {
            await this.inventory.releaseQuantity(tx, item.productId, item.quantity);
          }
        }
        restocked = true;
      }

      await this.loyalty.releaseWelcomeGift(tx, orderId);
      await this.coupons.releaseForOrder(tx, orderId);
      // The ledger keeps real money it saw; it just stops pointing at a deleted order.
      await tx.cryptoDeposit.updateMany({ where: { orderId }, data: { orderId: null } });
      // Items, events, proofs, deliveries, watches and redemptions cascade.
      await tx.order.delete({ where: { id: orderId } });

      return {
        result: { id: orderId, sequenceNumber: order.sequenceNumber, restocked },
        proofKeys: order.paymentProofs.map((p) => p.storageKey),
        status,
      };
    });

    // After commit: a file left behind is harmless, a row pointing at a deleted file is not.
    await Promise.all(proofKeys.map((key) => this.storage.delete(key)));
    await this.audit.log({
      actorStaffId: staffId,
      action: 'order.deleted',
      entityType: 'order',
      entityId: orderId,
      changes: { sequenceNumber: result.sequenceNumber, restocked: result.restocked },
    });
    this.logger.log(`Order #${result.sequenceNumber} (${orderId}) deleted by staff ${staffId}`);
    return result;
  }

  async deleteMany(orderIds: string[], staffId: string, restock = false) {
    const ids = [...new Set(orderIds)];
    if (ids.length === 0) throw new BadRequestException('No orders selected');
    if (ids.length > MAX_BULK_DELETE) {
      throw new BadRequestException(`At most ${MAX_BULK_DELETE} orders at a time`);
    }
    const deleted: DeleteOrderResult[] = [];
    const failed: { id: string; error: string }[] = [];
    // One transaction per order: one bad order must not keep the rest.
    for (const id of ids) {
      try {
        deleted.push(await this.deleteOrder(id, staffId, restock));
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { deleted, failed };
  }
}
