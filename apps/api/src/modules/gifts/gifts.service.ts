import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService, type OrderActor } from '../orders/orders.service';
import { DeliveryDispatcher } from '../delivery/delivery-dispatcher.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { PUBLIC_PREFIX, StorageService } from '../storage/storage.service';
import type { SubmitSocialRewardDto } from './dto/gifts.dto';

@Injectable()
export class GiftsService {
  private readonly logger = new Logger(GiftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly delivery: DeliveryDispatcher,
    private readonly notifications: NotificationDispatcher,
    private readonly storage: StorageService,
  ) {}

  /**
   * Claim an instant free gift (INSTANT_FREE type products).
   * No payment needed — creates an order at $0, auto-pays, triggers delivery.
   */
  async claimInstantGift(customerId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.status !== 'ACTIVE' || product.visibility !== 'VISIBLE') {
      throw new NotFoundException('Gift not found');
    }
    if (product.giftType !== 'INSTANT_FREE') {
      throw new BadRequestException('Product is not an instant free gift');
    }

    // Enforce stock limit
    if (product.maxGiftClaims !== null && product.giftClaimsCount >= product.maxGiftClaims) {
      throw new ConflictException('هذه الهدية نفدت! جرب مرة تانية في المرة الجاية.');
    }

    // One claim per customer per product
    const existing = await this.prisma.order.findFirst({
      where: {
        customerId,
        items: { some: { productId } },
        status: { notIn: ['CANCELLED'] },
      },
    });
    if (existing) {
      throw new ConflictException('لقد حصلت على هذه الهدية من قبل.');
    }

    const actor: OrderActor = { type: 'CUSTOMER', customerId };

    const order = await this.prisma.$transaction(async (tx) => {
      // Atomically increment claims count while checking limit
      const updated = await tx.product.updateMany({
        where: {
          id: productId,
          ...(product.maxGiftClaims !== null
            ? { giftClaimsCount: { lt: product.maxGiftClaims } }
            : {}),
        },
        data: { giftClaimsCount: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConflictException('هذه الهدية نفدت! جرب مرة تانية في المرة الجاية.');
      }

      // Create zero-price order
      const created = await tx.order.create({
        data: {
          customerId,
          currency: 'USD',
          subtotal: 0,
          discountTotal: 0,
          total: 0,
          idempotencyKey: randomUUID(),
        },
      });

      await tx.orderItem.create({
        data: {
          orderId: created.id,
          productId,
          productNameSnapshot: product.name,
          deliveryTypeSnapshot: product.deliveryType,
          fulfillmentTypeSnapshot: product.fulfillmentType,
          unitPrice: 0,
          quantity: 1,
        },
      });

      // Reserve inventory if needed
      if (product.inventoryMode === 'INDIVIDUAL') {
        const item = await tx.inventoryItem.findFirst({
          where: { productId, status: 'AVAILABLE' },
        });
        if (!item) {
          throw new ConflictException('هذه الهدية نفدت! جرب مرة تانية في المرة الجاية.');
        }
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { status: 'RESERVED', orderId: created.id },
        });
      } else if (product.inventoryMode === 'QUANTITY') {
        if (product.stock <= 0) {
          throw new ConflictException('هذه الهدية نفدت! جرب مرة تانية في المرة الجاية.');
        }
        await tx.product.update({ where: { id: productId }, data: { stock: { decrement: 1 } } });
      }

      await this.orders.transition(tx, created.id, 'PENDING_PAYMENT', actor);
      await this.settleFreeOrder(tx, created.id, { type: 'SYSTEM' }, 'هدية مجانية — لا يتطلب دفع');

      return tx.order.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } });
    });

    // Dispatch delivery after transaction commits
    await this.delivery.dispatch(order.id);

    this.logger.log(`Gift claimed: product=${productId} customer=${customerId} order=${order.id}`);

    await this.notifications.notifyStaff({
      kind: 'order.created',
      orderId: order.id,
      summary: `🎁 هدية مجانية: ${product.name} — ${order.id}`,
    });

    return order;
  }

  /**
   * A $0 order still walks SUBMITTED → REVIEW → PAID: the state machine has
   * no PENDING_PAYMENT → PAID edge, and skipping it is what made every
   * gift claim fail with a payment error.
   */
  private async settleFreeOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    actor: OrderActor,
    note: string,
  ) {
    await this.orders.transition(tx, orderId, 'PAYMENT_SUBMITTED', actor, note);
    await this.orders.transition(tx, orderId, 'PAYMENT_REVIEW', actor, note);
    await this.orders.transition(tx, orderId, 'PAID', actor, note);
  }

  /**
   * Submit a social reward claim (Facebook comment/rating proof).
   * Admin must approve before the gift is delivered.
   */
  async submitSocialReward(customerId: string, dto: SubmitSocialRewardDto) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.status !== 'ACTIVE' || product.visibility !== 'VISIBLE') {
      throw new NotFoundException('Gift not found');
    }
    if (product.giftType !== 'SOCIAL_REWARD') {
      throw new BadRequestException('Product is not a social reward gift');
    }
    // Only screenshots uploaded through our own endpoint: an arbitrary URL
    // would be loaded by every staff member who opens the claim.
    const ownPrefix = this.storage.publicUrl(`${PUBLIC_PREFIX}screenshots/`);
    if (dto.proofScreenshots.some((url) => !url.startsWith(ownPrefix) || url.includes('..'))) {
      throw new BadRequestException('ارفع صور الإثبات من التطبيق نفسه.');
    }

    // One pending/approved claim per customer per product per type
    const existing = await this.prisma.socialRewardClaim.findFirst({
      where: {
        customerId,
        productId: dto.productId,
        claimType: dto.claimType,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });
    if (existing) {
      throw new ConflictException('لديك طلب مكافأة معلق بالفعل لهذا المنتج.');
    }

    const claim = await this.prisma.socialRewardClaim.create({
      data: {
        productId: dto.productId,
        customerId,
        claimType: dto.claimType,
        facebookPostUrl: dto.facebookPostUrl,
        facebookProfileUrl: dto.facebookProfileUrl,
        proofScreenshots: dto.proofScreenshots,
        status: 'PENDING',
      },
    });

    await this.notifications.notifyStaff({
      kind: 'order.created',
      orderId: claim.id,
      summary: `🎁 طلب مكافأة اجتماعية جديد — ${product.name} — من عميل ${customerId}`,
    });

    return claim;
  }

  /** List pending social reward claims for admin review. */
  async listSocialRewardsPending(page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.socialRewardClaim.findMany({
        where: { status: 'PENDING' },
        include: {
          product: { select: { id: true, name: true, images: true } },
          customer: { select: { id: true, firstName: true, lastName: true, telegramUsername: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: pageSize,
      }),
      this.prisma.socialRewardClaim.count({ where: { status: 'PENDING' } }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
  }

  /** Approve a social reward claim — creates a zero-price order and triggers delivery. */
  async approveSocialReward(claimId: string, staffId: string) {
    const claim = await this.prisma.socialRewardClaim.findUnique({
      where: { id: claimId },
      include: { product: true },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status !== 'PENDING') throw new ConflictException('Claim is not pending');

    const { product } = claim;
    const actor: OrderActor = { type: 'STAFF', staffId };

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          customerId: claim.customerId,
          currency: 'USD',
          subtotal: 0,
          discountTotal: 0,
          total: 0,
          idempotencyKey: randomUUID(),
        },
      });

      await tx.orderItem.create({
        data: {
          orderId: created.id,
          productId: product.id,
          productNameSnapshot: product.name,
          deliveryTypeSnapshot: product.deliveryType,
          fulfillmentTypeSnapshot: product.fulfillmentType,
          unitPrice: 0,
          quantity: 1,
        },
      });

      await tx.socialRewardClaim.update({
        where: { id: claimId },
        data: {
          status: 'APPROVED',
          reviewedBy: staffId,
          reviewedAt: new Date(),
          orderId: created.id,
        },
      });

      await this.orders.transition(tx, created.id, 'PENDING_PAYMENT', { type: 'SYSTEM' });
      await this.settleFreeOrder(tx, created.id, actor, 'مكافأة تفاعل — تمت الموافقة');

      return tx.order.findUniqueOrThrow({ where: { id: created.id } });
    });

    await this.delivery.dispatch(order.id);
    this.logger.log(`Social reward approved: claim=${claimId} order=${order.id}`);
    return order;
  }

  /** Reject a social reward claim. */
  async rejectSocialReward(claimId: string, staffId: string, reason?: string) {
    const claim = await this.prisma.socialRewardClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status !== 'PENDING') throw new ConflictException('Claim is not pending');

    await this.prisma.socialRewardClaim.update({
      where: { id: claimId },
      data: {
        status: 'REJECTED',
        reviewedBy: staffId,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    });

    await this.notifications.notifyCustomer(claim.customerId, {
      kind: 'order.status_changed',
      orderId: claimId,
      status: 'CANCELLED',
      summary: `❌ طلب المكافأة رُفض.${reason ? `\nالسبب: ${reason}` : ''}`,
      silent: false,
    });
  }

  /** Get customer's own social reward claims. */
  async listCustomerSocialRewards(customerId: string) {
    return this.prisma.socialRewardClaim.findMany({
      where: { customerId },
      include: { product: { select: { id: true, name: true, images: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** List active instant-free gift products. */
  async listGiftProducts() {
    const products = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        giftType: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    return products.map((p) => ({
      ...p,
      costPrice: null,
      remainingClaims:
        p.maxGiftClaims !== null ? Math.max(0, p.maxGiftClaims - p.giftClaimsCount) : null,
      isSoldOut: p.maxGiftClaims !== null && p.giftClaimsCount >= p.maxGiftClaims,
    }));
  }
}
