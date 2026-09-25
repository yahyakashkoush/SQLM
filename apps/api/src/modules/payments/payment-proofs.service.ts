import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OrdersService } from '../orders/orders.service';
import {
  OrderNotAwaitingPaymentError,
  ProofAlreadyReviewedError,
  UnsupportedProofFileTypeError,
} from './errors/payment-proof.errors';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export interface UploadedProofFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@Injectable()
export class PaymentProofsService {
  private readonly logger = new Logger(PaymentProofsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * Gated entirely by order state: only `PENDING_PAYMENT` orders accept a
   * proof. Once uploaded, the order moves out of that state, so a second
   * upload attempt (double-tap, retried request) lands on the same
   * "not awaiting payment" conflict instead of creating a duplicate
   * submission — no separate dedup bookkeeping needed.
   */
  async uploadProof(orderId: string, customerId: string, file: UploadedProofFile) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedProofFileTypeError(file.mimetype);
    }

    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'PENDING_PAYMENT') {
      throw new OrderNotAwaitingPaymentError(orderId);
    }

    const extension = file.originalname.split('.').pop()?.slice(0, 10) ?? 'bin';
    const storageKey = `payment-proofs/${orderId}/${nanoid()}.${extension}`;
    await this.storage.upload(storageKey, file.buffer, file.mimetype);

    const proof = await this.prisma.$transaction(async (tx) => {
      const created = await tx.paymentProof.create({
        data: {
          orderId,
          customerId,
          storageKey,
          mimeType: file.mimetype,
          fileSize: file.size,
          status: 'PENDING',
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'PAYMENT_PROOF_UPLOADED',
          actorType: 'CUSTOMER',
          actorCustomerId: customerId,
        },
      });
      await this.orders.transition(tx, orderId, 'PAYMENT_SUBMITTED', {
        type: 'CUSTOMER',
        customerId,
      });
      await this.orders.transition(tx, orderId, 'PAYMENT_REVIEW', { type: 'SYSTEM' });

      return created;
    });

    this.logger.log(`Payment proof ${proof.id} uploaded for order ${orderId}`);
    return proof;
  }

  async listForOrder(orderId: string, customerId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) throw new NotFoundException('Order not found');
    return this.prisma.paymentProof.findMany({ where: { orderId }, orderBy: { uploadedAt: 'desc' } });
  }

  async listPendingAdmin() {
    return this.prisma.paymentProof.findMany({
      where: { status: 'PENDING' },
      orderBy: { uploadedAt: 'asc' },
      include: { order: true, customer: true },
    });
  }

  async findByIdAdmin(id: string) {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id },
      include: { order: true, customer: true },
    });
    if (!proof) throw new NotFoundException('Payment proof not found');
    return proof;
  }

  async getViewUrl(id: string): Promise<{ url: string }> {
    const proof = await this.findByIdAdmin(id);
    const url = await this.storage.getPresignedUrl(proof.storageKey, 900);
    return { url };
  }

  /** Atomic: the PENDING->APPROVED guard and the order transition to PAID happen in one transaction, so two admins racing to approve the same proof can't both succeed. */
  async approve(proofId: string, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const proof = await tx.paymentProof.findUnique({ where: { id: proofId } });
      if (!proof) throw new NotFoundException('Payment proof not found');

      const result = await tx.paymentProof.updateMany({
        where: { id: proofId, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedById: staffId, reviewedAt: new Date() },
      });
      if (result.count === 0) throw new ProofAlreadyReviewedError(proofId);

      await tx.orderEvent.create({
        data: {
          orderId: proof.orderId,
          type: 'PAYMENT_APPROVED',
          actorType: 'STAFF',
          actorStaffId: staffId,
        },
      });
      await this.orders.transition(tx, proof.orderId, 'PAID', { type: 'STAFF', staffId });

      return tx.paymentProof.findUniqueOrThrow({ where: { id: proofId } });
    });
  }

  async reject(proofId: string, staffId: string, reason: string, cancelOrder: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const proof = await tx.paymentProof.findUnique({ where: { id: proofId } });
      if (!proof) throw new NotFoundException('Payment proof not found');

      const result = await tx.paymentProof.updateMany({
        where: { id: proofId, status: 'PENDING' },
        data: { status: 'REJECTED', rejectionReason: reason, reviewedById: staffId, reviewedAt: new Date() },
      });
      if (result.count === 0) throw new ProofAlreadyReviewedError(proofId);

      await tx.orderEvent.create({
        data: {
          orderId: proof.orderId,
          type: 'PAYMENT_REJECTED',
          actorType: 'STAFF',
          actorStaffId: staffId,
          note: reason,
        },
      });
      await this.orders.transition(
        tx,
        proof.orderId,
        cancelOrder ? 'CANCELLED' : 'PENDING_PAYMENT',
        { type: 'STAFF', staffId },
        reason,
      );

      return tx.paymentProof.findUniqueOrThrow({ where: { id: proofId } });
    });
  }

  async addInternalNote(proofId: string, note: string) {
    const proof = await this.prisma.paymentProof.findUnique({ where: { id: proofId } });
    if (!proof) throw new NotFoundException('Payment proof not found');
    return this.prisma.paymentProof.update({ where: { id: proofId }, data: { internalNote: note } });
  }
}
