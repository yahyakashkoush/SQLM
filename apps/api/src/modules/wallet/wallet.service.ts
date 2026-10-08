import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { DeliveryDispatcher } from '../delivery/delivery-dispatcher.service';
import { CryptoWatchService } from '../crypto-payments/crypto-watch.service';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from '../orders/orders.service';
import { CartPricingService } from '../orders/cart-pricing.service';
import { CustomerSecurityService, isRestricted } from '../orders/customer-security.service';
import { matchesDeclaredType } from '../../common/utils/file-signature';
import {
  cleanSenderReference,
  MAX_PROOF_FILE_BYTES,
  type UploadedProofFile,
} from '../payments/payment-proofs.service';
import {
  ProofFileTooLargeError,
  UnsupportedProofFileTypeError,
} from '../payments/errors/payment-proof.errors';
import { creditWallet, debitWallet } from './wallet-ledger';
import type { AdjustWalletDto, CreateTopUpDto, ReviewTopUpDto } from './wallet.dto';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
/** Open requests per merchant. More than this is a queue nobody can review. */
const MAX_PENDING_TOPUPS = 3;

/**
 * The merchant wallet. Approved wholesale members top up with a transfer
 * receipt that staff review, then pay orders straight from the balance —
 * no receipt per order. Every movement is a WalletEntry written in the
 * same transaction as the balance change (see wallet-ledger.ts).
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationDispatcher,
    private readonly delivery: DeliveryDispatcher,
    private readonly cryptoWatch: CryptoWatchService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly pricing: CartPricingService,
    private readonly security: CustomerSecurityService,
  ) {}

  currency(): Promise<string> {
    return this.settings.getString('store.defaultCurrency');
  }

  async summary(customerId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { walletBalance: true, wholesaleAt: true },
    });
    const [currency, pending, entries] = await Promise.all([
      this.currency(),
      this.prisma.walletTopUp.findMany({
        where: { customerId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          currency: true,
          payAmount: true,
          payCurrency: true,
          createdAt: true,
        },
      }),
      this.prisma.walletEntry.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          currency: true,
          note: true,
          createdAt: true,
          order: { select: { id: true, sequenceNumber: true } },
        },
      }),
    ]);
    return {
      enabled: customer.wholesaleAt !== null,
      balance: customer.walletBalance.toFixed(2),
      currency,
      pendingTopUps: pending,
      entries,
    };
  }

  listTopUps(customerId: string) {
    return this.prisma.walletTopUp.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        amount: true,
        currency: true,
        payAmount: true,
        payCurrency: true,
        status: true,
        rejectReason: true,
        createdAt: true,
        reviewedAt: true,
        paymentMethod: { select: { name: true } },
      },
    });
  }

  /** What a top-up of `amount` costs to transfer with each manual method. */
  async topUpQuote(customerId: string, amount: number) {
    await this.assertMember(customerId);
    const currency = await this.currency();
    const methods = await this.prisma.paymentMethod.findMany({
      where: { enabled: true, provider: 'MANUAL' },
      orderBy: { displayOrder: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        accountNumber: true,
        instructions: true,
        qrCodeUrl: true,
        logoUrl: true,
        currency: true,
        provider: true,
      },
    });
    const value = new Prisma.Decimal(amount);
    return Promise.all(
      methods.map(async (m) => {
        const conversion = await this.pricing.conversionFor(value, currency, m);
        return {
          ...m,
          payAmount: (conversion?.amount ?? value).toFixed(2),
          payCurrency: conversion?.currency ?? currency,
        };
      }),
    );
  }

  async createTopUp(customerId: string, dto: CreateTopUpDto, file: UploadedProofFile) {
    const customer = await this.assertMember(customerId);
    if (isRestricted(customer))
      throw new ForbiddenException({ code: 'ACCOUNT_RESTRICTED', message: 'حسابك موقوف مؤقتًا.' });
    if (file.size > MAX_PROOF_FILE_BYTES) throw new ProofFileTooLargeError(MAX_PROOF_FILE_BYTES);
    if (!ALLOWED_MIME_TYPES.has(file.mimetype))
      throw new UnsupportedProofFileTypeError(file.mimetype);
    if (!matchesDeclaredType(file.buffer, file.mimetype)) {
      throw new UnsupportedProofFileTypeError(`${file.mimetype} (content does not match)`);
    }

    const method = await this.prisma.paymentMethod.findUnique({
      where: { id: dto.paymentMethodId },
    });
    if (!method || !method.enabled || method.provider !== 'MANUAL') {
      throw new ConflictException({
        code: 'PAYMENT_METHOD_UNAVAILABLE',
        message: 'طريقة الدفع دي مش متاحة للشحن.',
      });
    }

    const pending = await this.prisma.walletTopUp.count({
      where: { customerId, status: 'PENDING' },
    });
    if (pending >= MAX_PENDING_TOPUPS) {
      throw new ConflictException({
        code: 'TOO_MANY_PENDING_TOPUPS',
        message: `عندك ${pending} طلبات شحن لسه بتتراجع. استنى لما يتراجعوا الأول.`,
      });
    }

    // One receipt proves one transfer: the same bytes already sent for an
    // order or another top-up (anyone's, unless it was this merchant's and
    // got rejected) are a copy.
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');
    const [proofCopy, topUpCopy] = await Promise.all([
      this.prisma.paymentProof.findFirst({ where: { contentHash }, select: { id: true } }),
      this.prisma.walletTopUp.findFirst({
        where: { contentHash, NOT: { customerId, status: 'REJECTED' } },
        select: { id: true },
      }),
    ]);
    if (proofCopy || topUpCopy) {
      await this.security.recordStrike(
        customerId,
        'DUPLICATE_PROOF',
        'إيصال شحن رصيد اتبعت قبل كده',
      );
      throw new ConflictException({
        code: 'DUPLICATE_PROOF',
        message: 'الإيصال ده اتبعت قبل كده. ابعت إيصال التحويل الخاص بالشحنة دي بس.',
      });
    }

    const currency = await this.currency();
    const amount = new Prisma.Decimal(dto.amount);
    const conversion = await this.pricing.conversionFor(amount, currency, method);
    const extension = file.originalname.split('.').pop()?.slice(0, 10) ?? 'bin';
    const storageKey = `wallet-topups/${customerId}/${nanoid()}.${extension}`;
    await this.storage.upload(storageKey, file.buffer, file.mimetype);

    const topUp = await this.prisma.walletTopUp.create({
      data: {
        customerId,
        amount,
        currency,
        paymentMethodId: method.id,
        payCurrency: conversion?.currency,
        payAmount: conversion?.amount,
        exchangeRate: conversion?.rate,
        storageKey,
        mimeType: file.mimetype,
        contentHash,
        senderReference: cleanSenderReference(dto.senderReference),
      },
    });

    const paid = conversion
      ? `${conversion.amount.toFixed(2)} ${conversion.currency}`
      : `${amount.toFixed(2)} ${currency}`;
    await this.notifications.notifyStaff({
      kind: 'wallet.topup_requested',
      summary: `💳 طلب شحن رصيد ${amount.toFixed(2)} ${currency} (${paid}) — ${customer.fullName ?? customer.firstName ?? 'تاجر'}`,
      topUpId: topUp.id,
    });
    return topUp;
  }

  // ------------------------------------------------------------------ admin

  adminList(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.prisma.walletTopUp.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 100,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            fullName: true,
            telegramUsername: true,
            contactPhone: true,
            walletBalance: true,
          },
        },
        paymentMethod: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  async proofUrl(topUpId: string) {
    const topUp = await this.prisma.walletTopUp.findUnique({
      where: { id: topUpId },
      select: { storageKey: true, mimeType: true },
    });
    if (!topUp) throw new NotFoundException('Top-up not found');
    return {
      url: await this.storage.getPresignedUrl(topUp.storageKey, 900),
      mimeType: topUp.mimeType,
    };
  }

  /**
   * Approve credits the wallet once: the PENDING → APPROVED flip is a
   * conditional update in the same transaction as the credit, so a double
   * tap (or two reviewers at once) credits exactly one time.
   */
  async review(topUpId: string, staffId: string, dto: ReviewTopUpDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const topUp = await tx.walletTopUp.findUnique({ where: { id: topUpId } });
      if (!topUp) throw new NotFoundException('Top-up not found');
      const amount =
        dto.approve && dto.amount !== undefined ? new Prisma.Decimal(dto.amount) : topUp.amount;
      const flipped = await tx.walletTopUp.updateMany({
        where: { id: topUpId, status: 'PENDING' },
        data: {
          status: dto.approve ? 'APPROVED' : 'REJECTED',
          reviewedById: staffId,
          reviewedAt: new Date(),
          rejectReason: dto.approve ? null : dto.reason!.trim(),
          ...(dto.approve ? { amount } : {}),
        },
      });
      if (flipped.count === 0) {
        throw new ConflictException({
          code: 'ALREADY_REVIEWED',
          message: 'This top-up was already reviewed',
        });
      }
      const entry = dto.approve
        ? await creditWallet(tx, {
            customerId: topUp.customerId,
            amount,
            currency: topUp.currency,
            type: 'TOPUP',
            topUpId,
            staffId,
            note: amount.equals(topUp.amount)
              ? undefined
              : `طلب ${topUp.amount.toFixed(2)} — اتقبل ${amount.toFixed(2)}`,
          })
        : null;
      return { topUp, amount, entry };
    });

    const { topUp, amount, entry } = result;
    await this.audit.log({
      actorStaffId: staffId,
      action: dto.approve ? 'wallet.topup_approved' : 'wallet.topup_rejected',
      entityType: 'customer',
      entityId: topUp.customerId,
      changes: { topUpId, amount: amount.toFixed(2), reason: dto.reason ?? null },
    });
    await this.notifications.notifyCustomer(topUp.customerId, {
      kind: 'wallet.topup_reviewed',
      summary: dto.approve
        ? `✅ اتشحن رصيدك ${amount.toFixed(2)} ${topUp.currency}. رصيدك دلوقتي ${entry!.balanceAfter.toFixed(2)} ${topUp.currency}.`
        : `❌ طلب شحن الرصيد (${topUp.amount.toFixed(2)} ${topUp.currency}) اترفض: ${dto.reason!.trim()}`,
    });
    return {
      id: topUpId,
      status: dto.approve ? 'APPROVED' : 'REJECTED',
      balance: entry?.balanceAfter.toFixed(2) ?? null,
    };
  }

  async adminWallet(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { walletBalance: true, wholesaleAt: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const [currency, entries] = await Promise.all([
      this.currency(),
      this.prisma.walletEntry.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          order: { select: { id: true, sequenceNumber: true } },
          staff: { select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      balance: customer.walletBalance.toFixed(2),
      currency,
      member: customer.wholesaleAt !== null,
      entries,
    };
  }

  /** A correction or refund by hand. Signed amount; a debit can't overdraw. */
  async adjust(customerId: string, staffId: string, dto: AdjustWalletDto) {
    const exists = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Customer not found');
    if (dto.amount === 0)
      throw new ConflictException({ code: 'ZERO_AMOUNT', message: 'Amount cannot be zero' });
    const currency = await this.currency();
    const amount = new Prisma.Decimal(Math.abs(dto.amount));
    const move = {
      customerId,
      amount,
      currency,
      type: dto.type,
      staffId,
      orderId: dto.orderId,
      note: dto.note.trim(),
    } as const;
    const entry = await this.prisma.$transaction((tx) =>
      dto.amount > 0 ? creditWallet(tx, move) : debitWallet(tx, move),
    );
    await this.audit.log({
      actorStaffId: staffId,
      action: 'wallet.adjusted',
      entityType: 'customer',
      entityId: customerId,
      changes: { amount: dto.amount, type: dto.type, note: dto.note, orderId: dto.orderId ?? null },
    });
    await this.notifications.notifyCustomer(customerId, {
      kind: 'wallet.adjusted',
      summary:
        dto.amount > 0
          ? `💰 اتضاف لرصيدك ${amount.toFixed(2)} ${currency} — ${dto.note.trim()}. رصيدك: ${entry.balanceAfter.toFixed(2)} ${currency}.`
          : `اتخصم من رصيدك ${amount.toFixed(2)} ${currency} — ${dto.note.trim()}. رصيدك: ${entry.balanceAfter.toFixed(2)} ${currency}.`,
    });
    return { balance: entry.balanceAfter.toFixed(2), entry };
  }

  // ------------------------------------------------------------------ paying

  /** Pays an order that is waiting for payment from the wallet, in full. */
  async payOrder(customerId: string, orderId: string) {
    await this.assertMember(customerId);
    const currency = await this.currency();
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException({
        code: 'ORDER_NOT_AWAITING_PAYMENT',
        message: 'الطلب ده مش مستني دفع.',
      });
    }
    if (order.currency !== currency) {
      throw new ConflictException({
        code: 'WALLET_CURRENCY_MISMATCH',
        message: `الرصيد بالـ ${currency} والطلب بالـ ${order.currency} — مينفعش يتدفع من الرصيد.`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await debitWallet(tx, {
        customerId,
        amount: order.total,
        currency,
        type: 'PURCHASE',
        orderId,
        note: `طلب #${order.sequenceNumber}`,
      });
      await this.orders.settleFromWallet(tx, orderId, customerId);
    });
    await this.cryptoWatch.cancelForOrder(orderId);
    await this.afterWalletPayment(orderId);
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
  }

  async afterWalletPayment(orderId: string) {
    await this.delivery.dispatch(orderId);
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { sequenceNumber: true, total: true, currency: true },
    });
    await this.notifications.notifyStaff({
      kind: 'payment.reviewed',
      orderId,
      summary: `💳 طلب #${order.sequenceNumber} اتدفع من رصيد المحفظة — ${order.total.toFixed(2)} ${order.currency}`,
    });
  }

  private async assertMember(customerId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    if (!customer.wholesaleAt) {
      throw new ForbiddenException({
        code: 'WALLET_MERCHANTS_ONLY',
        message: 'المحفظة لتجار الجملة المعتمدين بس.',
      });
    }
    return customer;
  }
}
