import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Delivery } from '@prisma/client';
import {
  decryptSecret,
  encryptSecret,
  type DeliveryMethod,
  type DeliveryType,
  type InventoryMode,
} from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { DeliveryNotFulfillableError, DeliveryAlreadyCompletedError } from './errors/delivery.errors';

type PrismaTx = Prisma.TransactionClient;

export interface CustomerDeliveryView {
  id: string;
  orderItemId: string;
  productName: string;
  method: DeliveryMethod;
  status: string;
  content: string | null;
  note: string | null;
  deliveredAt: Date | null;
}

/**
 * Turns a PAID order into delivered goods.
 *
 * Automatic fulfillment hands over the secrets already reserved-and-sold
 * for the order by Phase 4/5 (`InventoryItem.orderId`, status SOLD) —
 * fulfillment never picks new inventory, so it cannot hand a customer an
 * item that belongs to a different order. Manual fulfillment parks the
 * order at READY_FOR_DELIVERY for a DELIVERY_AGENT to complete.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  private get encryptionKey(): string {
    return this.config.getOrThrow<string>('INVENTORY_ENCRYPTION_KEY');
  }

  /**
   * A product is auto-deliverable only when there is a stored secret to
   * deliver. MANUAL/CUSTOM are manual by the admin's explicit choice;
   * everything else still needs INDIVIDUAL inventory behind it, otherwise
   * there is nothing to hand over and a human has to do the work.
   */
  static resolveMethod(deliveryType: DeliveryType, inventoryMode: InventoryMode): DeliveryMethod {
    if (deliveryType === 'MANUAL' || deliveryType === 'CUSTOM') return 'MANUAL';
    return inventoryMode === 'INDIVIDUAL' ? 'AUTOMATIC' : 'MANUAL';
  }

  /**
   * Idempotent by construction, in three layers: the PAID->PROCESSING
   * transition is a state-machine guard only one runner can win, the
   * Delivery row has a unique constraint on orderItemId, and each row is
   * only filled in when it is still PENDING. Safe to run twice, and safe
   * for two workers to run concurrently.
   */
  async fulfillOrder(orderId: string): Promise<{ delivered: number; manual: number }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === 'PAID') {
      await this.orders.transitionStandalone(orderId, 'PROCESSING', { type: 'SYSTEM' });
    } else if (order.status !== 'PROCESSING' && order.status !== 'READY_FOR_DELIVERY') {
      // Already delivered/completed/cancelled — a replayed job, nothing to do.
      this.logger.log(`Skipping fulfillment for order ${orderId}: status is ${order.status}`);
      return { delivered: 0, manual: 0 };
    }

    let delivered = 0;
    let manual = 0;

    for (const item of order.items) {
      const method = DeliveryService.resolveMethod(
        item.deliveryTypeSnapshot as DeliveryType,
        item.product.inventoryMode as InventoryMode,
      );

      const record = await this.ensureDeliveryRow(item.id, orderId, method);
      if (record.status === 'DELIVERED') {
        delivered += 1;
        continue;
      }

      if (method === 'MANUAL') {
        manual += 1;
        continue;
      }

      const ok = await this.deliverAutomatically(record.id, orderId, item.id, item.quantity);
      if (ok) delivered += 1;
      else manual += 1;
    }

    await this.advanceOrderAfterFulfillment(orderId);

    if (delivered > 0) {
      await this.notifications.notifyCustomer(order.customerId, {
        kind: 'delivery.completed',
        orderId,
        summary: `Order #${order.sequenceNumber}: ${delivered} item(s) delivered — open the app to view them`,
      });
    }
    if (manual > 0) {
      await this.notifications.notifyStaff({
        kind: 'delivery.failed',
        orderId,
        summary: `Order #${order.sequenceNumber} has ${manual} item(s) awaiting manual delivery`,
      });
    }

    return { delivered, manual };
  }

  private async ensureDeliveryRow(
    orderItemId: string,
    orderId: string,
    method: DeliveryMethod,
  ): Promise<Delivery> {
    const existing = await this.prisma.delivery.findUnique({ where: { orderItemId } });
    if (existing) return existing;

    try {
      return await this.prisma.delivery.create({
        data: { orderId, orderItemId, method, status: 'PENDING' },
      });
    } catch (err) {
      // A concurrent worker created it first — take theirs, never a second row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.delivery.findUniqueOrThrow({ where: { orderItemId } });
      }
      throw err;
    }
  }

  /**
   * Claims the order's own SOLD inventory items and writes them into the
   * delivery record. The `status: 'PENDING'` guard on the update is the
   * thing that makes a duplicate worker a no-op: the second one updates 0
   * rows and never marks inventory DELIVERED twice.
   */
  private async deliverAutomatically(
    deliveryId: string,
    orderId: string,
    orderItemId: string,
    quantity: number,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const claimed = await this.claimInventoryForItem(tx, orderId, orderItemId, quantity);

        if (claimed.length < quantity) {
          await tx.delivery.updateMany({
            where: { id: deliveryId, status: 'PENDING' },
            data: {
              method: 'MANUAL',
              attempts: { increment: 1 },
              lastError: `Expected ${quantity} sold inventory item(s), found ${claimed.length}`,
            },
          });
          return false;
        }

        const plaintext = claimed
          .map((i) => decryptSecret(i.encryptedPayload, this.encryptionKey))
          .join('\n');

        const updated = await tx.delivery.updateMany({
          where: { id: deliveryId, status: 'PENDING' },
          data: {
            status: 'DELIVERED',
            encryptedContent: encryptSecret(plaintext, this.encryptionKey),
            inventoryItemIds: claimed.map((i) => i.id),
            attempts: { increment: 1 },
            deliveredAt: new Date(),
            lastError: null,
          },
        });
        if (updated.count === 0) {
          // Lost the race; the winner already delivered these items.
          throw new DeliveryAlreadyCompletedError(deliveryId);
        }

        await tx.inventoryItem.updateMany({
          where: { id: { in: claimed.map((i) => i.id) } },
          data: { status: 'DELIVERED', deliveredAt: new Date() },
        });

        await tx.orderEvent.create({
          data: {
            orderId,
            type: 'DELIVERY_COMPLETED',
            actorType: 'SYSTEM',
            note: `Automatic delivery of ${claimed.length} item(s)`,
          },
        });

        return true;
      });
    } catch (err) {
      if (err instanceof DeliveryAlreadyCompletedError) return true;
      const message = err instanceof Error ? err.message : 'Unknown delivery error';
      await this.prisma.delivery.updateMany({
        where: { id: deliveryId, status: 'PENDING' },
        data: { status: 'FAILED', attempts: { increment: 1 }, lastError: message },
      });
      await this.prisma.orderEvent.create({
        data: { orderId, type: 'DELIVERY_FAILED', actorType: 'SYSTEM', note: message },
      });
      await this.notifications.notifyStaff({
        kind: 'delivery.failed',
        orderId,
        summary: `Automatic delivery failed for order ${orderId}: ${message}`,
      });
      this.logger.error(`Automatic delivery failed for order ${orderId}: ${message}`);
      throw err;
    }
  }

  /**
   * `FOR UPDATE SKIP LOCKED` over this order's own SOLD, not-yet-delivered
   * items. Scoping to `orderId` means two delivery workers racing on the
   * same order compete for the same rows and one comes away empty, rather
   * than each pulling a different (and wrongly-owned) set.
   */
  private async claimInventoryForItem(
    tx: PrismaTx,
    orderId: string,
    orderItemId: string,
    quantity: number,
  ): Promise<Array<{ id: string; encryptedPayload: string }>> {
    const orderItem = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId } });

    return tx.$queryRaw<Array<{ id: string; encryptedPayload: string }>>`
      SELECT id, "encryptedPayload" FROM inventory_items
      WHERE "orderId" = ${orderId}
        AND "productId" = ${orderItem.productId}
        AND status = 'SOLD'
      ORDER BY "soldAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${quantity}
    `;
  }

  /** READY_FOR_DELIVERY while anything is outstanding; DELIVERED once every row is done. */
  private async advanceOrderAfterFulfillment(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== 'PROCESSING' && order.status !== 'READY_FOR_DELIVERY') return;

    const outstanding = await this.prisma.delivery.count({
      where: { orderId, status: { not: 'DELIVERED' } },
    });

    if (order.status === 'PROCESSING') {
      await this.orders.transitionStandalone(orderId, 'READY_FOR_DELIVERY', { type: 'SYSTEM' });
    }
    if (outstanding === 0) {
      await this.orders.transitionStandalone(orderId, 'DELIVERED', { type: 'SYSTEM' });
    }
  }

  /** A DELIVERY_AGENT completing a manual item (activation details, a code they generated, ...). */
  async fulfillManually(
    deliveryId: string,
    staffId: string,
    content: string,
    note?: string,
  ): Promise<Delivery> {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status === 'DELIVERED') throw new DeliveryAlreadyCompletedError(deliveryId);

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: delivery.orderId } });
    if (order.status !== 'PROCESSING' && order.status !== 'READY_FOR_DELIVERY') {
      throw new DeliveryNotFulfillableError(delivery.orderId, order.status);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.delivery.updateMany({
        where: { id: deliveryId, status: { not: 'DELIVERED' } },
        data: {
          status: 'DELIVERED',
          encryptedContent: encryptSecret(content, this.encryptionKey),
          note,
          attempts: { increment: 1 },
          deliveredAt: new Date(),
          deliveredByStaffId: staffId,
          lastError: null,
        },
      });
      if (result.count === 0) throw new DeliveryAlreadyCompletedError(deliveryId);

      await tx.orderEvent.create({
        data: {
          orderId: delivery.orderId,
          type: 'DELIVERY_COMPLETED',
          actorType: 'STAFF',
          actorStaffId: staffId,
          note: note ?? 'Manual delivery',
        },
      });

      return tx.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    });

    await this.advanceOrderAfterFulfillment(delivery.orderId);
    await this.notifications.notifyCustomer(order.customerId, {
      kind: 'delivery.completed',
      orderId: delivery.orderId,
      summary: `Order #${order.sequenceNumber}: your item is ready — open the app to view it`,
    });
    return updated;
  }

  /** Customer-facing: decrypts only their own delivered content. */
  async listForOrderCustomer(orderId: string, customerId: string): Promise<CustomerDeliveryView[]> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) throw new NotFoundException('Order not found');

    const rows = await this.prisma.delivery.findMany({
      where: { orderId },
      include: { orderItem: true },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      orderItemId: row.orderItemId,
      productName: row.orderItem.productNameSnapshot,
      method: row.method as DeliveryMethod,
      status: row.status,
      content:
        row.status === 'DELIVERED' && row.encryptedContent
          ? decryptSecret(row.encryptedContent, this.encryptionKey)
          : null,
      note: row.note,
      deliveredAt: row.deliveredAt,
    }));
  }

  /** Staff queue view: everything still waiting on a human. */
  async listPendingManual() {
    return this.prisma.delivery.findMany({
      where: { method: 'MANUAL', status: { not: 'DELIVERED' } },
      include: { order: true, orderItem: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listForOrderAdmin(orderId: string) {
    return this.prisma.delivery.findMany({
      where: { orderId },
      include: { orderItem: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
