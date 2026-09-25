import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { InventoryItem, Prisma } from '@prisma/client';
import { encryptSecret, decryptSecret, type PaginatedResult } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InsufficientInventoryError } from './errors/insufficient-inventory.error';
import type { InventoryQueryDto } from './dto/inventory-query.dto';

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private get encryptionKey(): string {
    return this.config.getOrThrow<string>('INVENTORY_ENCRYPTION_KEY');
  }

  async bulkImport(productId: string, secrets: string[]): Promise<{ imported: number }> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.inventoryMode !== 'INDIVIDUAL') {
      throw new ForbiddenException('Product is not configured for individual inventory items');
    }

    const key = this.encryptionKey;
    await this.prisma.inventoryItem.createMany({
      data: secrets.map((secret) => ({
        productId,
        encryptedPayload: encryptSecret(secret, key),
      })),
    });

    this.logger.log(`Imported ${secrets.length} inventory item(s) for product ${productId}`);
    return { imported: secrets.length };
  }

  async listForProduct(
    productId: string,
    query: InventoryQueryDto,
  ): Promise<PaginatedResult<Omit<InventoryItem, 'encryptedPayload'>>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.InventoryItemWhereInput = {
      productId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Never return encryptedPayload in list views — reveal is a separate, audited action.
        select: {
          id: true,
          productId: true,
          status: true,
          reservedAt: true,
          soldAt: true,
          deliveredAt: true,
          disabledReason: true,
          orderId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** Decrypts and returns the plaintext secret. Sensitive — always audit-logged with the requesting staff id. */
  async revealSecret(itemId: string, staffId: string): Promise<{ secret: string }> {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Inventory item not found');

    const secret = decryptSecret(item.encryptedPayload, this.encryptionKey);
    await this.audit.log({
      actorStaffId: staffId,
      action: 'inventory.reveal_secret',
      entityType: 'InventoryItem',
      entityId: itemId,
    });
    return { secret };
  }

  async disable(itemId: string, reason: string): Promise<InventoryItem> {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Inventory item not found');
    return this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: { status: 'DISABLED', disabledReason: reason },
    });
  }

  async availableCount(productId: string): Promise<number> {
    return this.prisma.inventoryItem.count({ where: { productId, status: 'AVAILABLE' } });
  }

  /**
   * Atomically claims `quantity` AVAILABLE individual items for `orderId`.
   * `FOR UPDATE SKIP LOCKED` means concurrent reservations for the same
   * product never block each other on rows another transaction is already
   * claiming — they just compete for what's left, which is exactly the
   * "simultaneous purchases" safety property the platform needs. Must run
   * inside the caller's transaction (`tx`), not a standalone query, or the
   * row locks won't hold across the subsequent UPDATE.
   */
  async reserveIndividualItems(
    tx: PrismaTx,
    productId: string,
    quantity: number,
    orderId: string,
  ): Promise<InventoryItem[]> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM inventory_items
      WHERE "productId" = ${productId} AND status = 'AVAILABLE'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${quantity}
    `;

    if (locked.length < quantity) {
      throw new InsufficientInventoryError(productId, quantity, locked.length);
    }

    const ids = locked.map((row) => row.id);
    await tx.inventoryItem.updateMany({
      where: { id: { in: ids } },
      data: { status: 'RESERVED', reservedAt: new Date(), orderId },
    });

    return tx.inventoryItem.findMany({ where: { id: { in: ids } } });
  }

  /**
   * Atomically decrements QUANTITY-mode stock. Safe under concurrency
   * without explicit locking: Postgres re-evaluates the WHERE clause
   * against the committed row when a blocked UPDATE unblocks, so a second
   * concurrent buyer racing for the last unit always sees `count === 0`
   * (never oversells) instead of a stale pre-decrement value.
   */
  async reserveQuantity(tx: PrismaTx, productId: string, quantity: number): Promise<void> {
    const result = await tx.product.updateMany({
      where: { id: productId, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } },
    });
    if (result.count === 0) {
      const product = await tx.product.findUnique({ where: { id: productId } });
      throw new InsufficientInventoryError(productId, quantity, product?.stock ?? 0);
    }
  }

  /** Releases a reservation back to the pool (order cancelled/expired before payment). */
  async releaseIndividualItems(tx: PrismaTx, orderId: string): Promise<void> {
    await tx.inventoryItem.updateMany({
      where: { orderId, status: 'RESERVED' },
      data: { status: 'AVAILABLE', reservedAt: null, orderId: null },
    });
  }

  async releaseQuantity(tx: PrismaTx, productId: string, quantity: number): Promise<void> {
    await tx.product.update({
      where: { id: productId },
      data: { stock: { increment: quantity } },
    });
  }

  /** Marks reserved items SOLD at the moment payment is approved (still not delivered). */
  async markIndividualItemsSold(tx: PrismaTx, orderId: string): Promise<void> {
    await tx.inventoryItem.updateMany({
      where: { orderId, status: 'RESERVED' },
      data: { status: 'SOLD', soldAt: new Date() },
    });
  }
}
