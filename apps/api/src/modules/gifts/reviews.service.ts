import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProductReviewDto } from './dto/gifts.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Submit a review for a product from a completed order.
   * Only one review per (customer, order, product).
   */
  async createReview(customerId: string, dto: CreateProductReviewDto) {
    // Verify the order exists and belongs to this customer
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: { items: { where: { productId: dto.productId } } },
    });
    if (!order || order.customerId !== customerId) {
      throw new NotFoundException('Order not found');
    }
    if (order.items.length === 0) {
      throw new BadRequestException('This product was not in the order');
    }
    if (!['DELIVERED', 'COMPLETED'].includes(order.status)) {
      throw new BadRequestException('يمكنك تقييم المنتج فقط بعد استلام طلبك.');
    }

    // One review per order-product pair (enforced by DB unique too)
    const existing = await this.prisma.productReview.findUnique({
      where: { orderId: dto.orderId },
    });
    if (existing) {
      throw new ConflictException('لقد قيّمت هذا الطلب مسبقاً.');
    }

    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productReview.create({
        data: {
          productId: dto.productId,
          customerId,
          orderId: dto.orderId,
          rating: dto.rating,
          title: dto.title,
          comment: dto.comment,
          attachmentUrls: dto.attachmentUrls ?? [],
          verified: true,
        },
      });

      // Recalculate product rating
      const agg = await tx.productReview.aggregate({
        where: { productId: dto.productId },
        _avg: { rating: true },
        _count: { id: true },
      });

      await tx.product.update({
        where: { id: dto.productId },
        data: {
          ratingScore: agg._avg.rating ?? 0,
          reviewCount: agg._count.id,
        },
      });

      return created;
    });

    return review;
  }

  /** List reviews for a product (public). */
  async listProductReviews(productId: string, page = 1, pageSize = 10) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({
        where: { productId, verified: true },
        include: {
          customer: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.productReview.count({ where: { productId, verified: true } }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
  }

  /** Mark a review as helpful (increment counter). */
  async markHelpful(reviewId: string) {
    const review = await this.prisma.productReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    return this.prisma.productReview.update({
      where: { id: reviewId },
      data: { helpful: { increment: 1 } },
    });
  }

  /** Admin: list all reviews with moderation options. */
  async listAdmin(page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({
        include: {
          product: { select: { id: true, name: true } },
          customer: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.productReview.count(),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
  }

  /** Admin: delete a review. */
  async deleteReview(reviewId: string) {
    const review = await this.prisma.productReview.findUnique({
      where: { id: reviewId },
      select: { productId: true },
    });
    if (!review) throw new NotFoundException('Review not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.productReview.delete({ where: { id: reviewId } });

      const agg = await tx.productReview.aggregate({
        where: { productId: review.productId },
        _avg: { rating: true },
        _count: { id: true },
      });

      await tx.product.update({
        where: { id: review.productId },
        data: {
          ratingScore: agg._avg.rating ?? 0,
          reviewCount: agg._count.id,
        },
      });
    });
  }
}
