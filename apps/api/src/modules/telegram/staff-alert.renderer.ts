import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Permission } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { NotificationJob } from '../notifications/notification-dispatcher.service';
import { assessProofRisk } from '../payments/proof-risk';

export interface StaffAlertButton {
  text: string;
  /** Exactly one of the two. */
  callbackData?: string;
  url?: string;
}

export interface StaffAlert {
  /** Only staff whose role grants this receive the alert. */
  permission: Permission;
  text: string;
  /** The payment screenshot, for a proof alert. */
  file?: { buffer: Buffer; filename: string; asPhoto: boolean };
  buttons: StaffAlertButton[][];
}

/** Telegram's caption limit; the text is kept under it so it can ride on the photo. */
const CAPTION_LIMIT = 1024;
const MAX_ITEM_LINES = 5;

const MEMBER_DISCOUNT_LABELS = {
  VERIFIED: 'خصم العميل المميز',
  WELCOME: 'هدية أول طلب',
  LEGACY: 'خصم العميل القديم',
} as const;

type OrderForAlert = Prisma.OrderGetPayload<{
  include: {
    items: true;
    customer: true;
    paymentMethod: true;
  };
}>;

/**
 * Turns a staff notification into the Telegram message a store owner
 * reads on their phone: who ordered, what, how much, and — for a payment
 * proof — the screenshot itself with approve/reject buttons under it.
 *
 * Rendered from the database at send time rather than from the job, so
 * the message shows the order as it is now, and nothing sensitive has to
 * sit in Redis. Returns null for events staff do not need pushed (a
 * payment someone on the team just approved themselves).
 */
@Injectable()
export class StaffAlertRenderer {
  private readonly logger = new Logger(StaffAlertRenderer.name);
  private readonly adminUrl: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    const url = (config.get<string>('ADMIN_URL') ?? '').replace(/\/$/, '');
    // Telegram refuses non-https URL buttons (localhost included), and one
    // bad button fails the whole message — so no link beats a broken one.
    this.adminUrl = url.startsWith('https://') ? url : null;
  }

  async render(job: NotificationJob): Promise<StaffAlert | null> {
    switch (job.kind) {
      case 'order.created':
        return this.orderAlert(job.orderId, 'orders.read', (o) =>
          o.walletPaid
            ? [`🛒 طلب جديد #${o.sequenceNumber}`, '💳 اتدفع من رصيد المحفظة — اتأكد تلقائي.']
            : o.paymentMethod && o.paymentMethod.provider !== 'MANUAL'
              ? [`🛒 طلب جديد #${o.sequenceNumber}`, '⚡ دفع كريبتو — هيتأكد تلقائي أول ما التحويل يوصل.']
              : [`🛒 طلب جديد #${o.sequenceNumber}`, '⏳ مستني إثبات الدفع.'],
        );
      case 'payment.submitted':
        return this.proofAlert(job.orderId);
      case 'payment.reviewed':
        // Proofs reviewed by staff are not news to staff. A deposit the
        // poller settled on its own is: nobody on the team saw it happen.
        if (!job.autoSettled) return null;
        return this.orderAlert(job.orderId, 'orders.read', (o) => [
          o.walletPaid
            ? `💳 اتدفع من رصيد المحفظة — طلب #${o.sequenceNumber}`
            : `💰 اتدفع تلقائي (كريبتو) — طلب #${o.sequenceNumber}`,
        ]);
      case 'wallet.topup_requested':
        return this.topUpAlert(job);
      case 'delivery.failed':
        return this.orderAlert(job.orderId, 'delivery.read', (o) =>
          typeof job.manualCount === 'number'
            ? [`📦 طلب #${o.sequenceNumber} محتاج تسليم يدوي (${job.manualCount} منتج).`]
            : [`🚨 التسليم التلقائي فشل — طلب #${o.sequenceNumber}`, job.summary],
        );
      case 'crypto.deposit_unmatched':
        return {
          permission: 'payments.proofs.review',
          text: clip(['⚠️ إيداع كريبتو وصل ومش متطابق مع أي طلب', job.summary, job.body ?? ''].join('\n\n')),
          buttons: this.link('🔎 راجع وطابقه', '/crypto-payments'),
        };
      case 'support.ticket_created':
      case 'support.customer_reply':
        return this.ticketAlert(job);
      case 'appeal.created':
        return {
          permission: 'customers.ban',
          text: clip([job.summary, job.body ?? ''].filter(Boolean).join('\n\n')),
          buttons: [
            [
              { text: '✅ قبول ورفع الإيقاف', callbackData: `ad:apA:${String(job.appealId)}` },
              { text: '❌ رفض', callbackData: `ad:apR:${String(job.appealId)}` },
            ],
            ...this.link('👤 العميل', `/customers/${String(job.customerId)}`),
          ],
        };
      case 'wholesale.applied':
        return {
          permission: 'customers.write',
          text: clip([job.summary, job.body ?? ''].filter(Boolean).join('\n\n')),
          buttons: [
            [
              { text: '✅ قبول', callbackData: `ad:whA:${String(job.applicationId)}` },
              { text: '❌ رفض', callbackData: `ad:whR:${String(job.applicationId)}` },
            ],
            ...this.link('🏪 طلبات الجملة', '/wholesale'),
          ],
        };
      case 'customer.strike':
        return {
          permission: 'customers.ban',
          text: clip(`${job.summary}\n${job.action === 'BAN' ? '🚫 العميل اتحظر تلقائي.' : '⏸️ العميل اتوقف مؤقتاً.'}`),
          buttons: this.link('👤 العميل', `/customers/${String(job.customerId)}`),
        };
      case 'inventory.low_stock':
        return {
          permission: 'inventory.read',
          text: `📉 المخزون قرب يخلص: ${String(job.productName ?? '')} — فاضل ${String(job.remaining ?? '?')}`,
          buttons: this.link('📦 المخزون', '/inventory'),
        };
      default:
        return null;
    }
  }

  private async proofAlert(orderId: string | undefined): Promise<StaffAlert | null> {
    const order = await this.loadOrder(orderId);
    if (!order) return null;

    const proof = await this.prisma.paymentProof.findFirst({
      where: { orderId: order.id },
      orderBy: { uploadedAt: 'desc' },
    });
    const pending = proof?.status === 'PENDING';
    // Warnings first: the caption is clipped from the end, and these are
    // what must not be lost.
    const risk = proof ? await assessProofRisk(this.prisma, proof) : null;
    const text = clip(
      [
        `🧾 إثبات دفع — طلب #${order.sequenceNumber}`,
        ...(risk && risk.flags.length > 0 ? [risk.flags.join('\n')] : []),
        ...(proof?.senderReference ? [`📱 حوّل من: ${proof.senderReference}`] : []),
        describeOrder(order),
        pending ? '👇 راجع الإيصال على كشف الحساب وقرّر:' : '✔️ الإثبات ده اتراجع خلاص.',
      ].join('\n\n'),
    );

    let file: StaffAlert['file'];
    if (proof) {
      try {
        const stored = await this.storage.read(proof.storageKey);
        if (stored) {
          const extension = proof.storageKey.split('.').pop() ?? 'jpg';
          file = {
            buffer: stored.buffer,
            filename: `proof-${order.sequenceNumber}.${extension}`,
            // Telegram re-encodes photos; a PDF has to go as a document.
            asPhoto: proof.mimeType.startsWith('image/'),
          };
        }
      } catch (err) {
        // The alert is still useful without the picture; the dashboard link has it.
        this.logger.warn(`Could not attach proof ${proof.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const buttons: StaffAlertButton[][] = pending
      ? [
          [
            { text: '✅ قبول', callbackData: `pa:${proof!.id}` },
            { text: '❌ رفض', callbackData: `pr:${proof!.id}` },
          ],
        ]
      : [];
    buttons.push(...this.link('🔗 فتح الطلب', `/orders/${order.id}`));

    return { permission: 'payments.proofs.read', text, file, buttons };
  }

  private async topUpAlert(job: NotificationJob): Promise<StaffAlert | null> {
    if (typeof job.topUpId !== 'string') return null;
    const topUp = await this.prisma.walletTopUp.findUnique({
      where: { id: job.topUpId },
      include: { customer: true, paymentMethod: true },
    });
    if (!topUp) return null;
    const pending = topUp.status === 'PENDING';
    const paid = topUp.payAmount ? `${topUp.payAmount.toFixed(2)} ${topUp.payCurrency}` : null;
    const text = clip(
      [
        `💳 طلب شحن رصيد — ${topUp.amount.toFixed(2)} ${topUp.currency}`,
        ...(paid ? [`💵 المفروض يحوّل: ${paid}`] : []),
        ...(topUp.paymentMethod ? [`🏦 ${topUp.paymentMethod.name}`] : []),
        ...(topUp.senderReference ? [`📱 حوّل من: ${topUp.senderReference}`] : []),
        `🏪 ${describeCustomer(topUp.customer)} · رصيده الحالي ${topUp.customer.walletBalance.toFixed(2)} ${topUp.currency}`,
        pending ? '👇 راجع التحويل على كشف الحساب وقرّر:' : '✔️ الطلب ده اتراجع خلاص.',
      ].join('\n\n'),
    );
    let file: StaffAlert['file'];
    try {
      const stored = await this.storage.read(topUp.storageKey);
      if (stored) {
        const extension = topUp.storageKey.split('.').pop() ?? 'jpg';
        file = { buffer: stored.buffer, filename: `topup.${extension}`, asPhoto: topUp.mimeType.startsWith('image/') };
      }
    } catch (err) {
      this.logger.warn(`Could not attach top-up receipt ${topUp.id}: ${err instanceof Error ? err.message : err}`);
    }
    const buttons: StaffAlertButton[][] = pending
      ? [
          [
            { text: '✅ قبول وشحن', callbackData: `ad:tuA:${topUp.id}` },
            { text: '❌ رفض', callbackData: `ad:tuR:${topUp.id}` },
          ],
        ]
      : [];
    buttons.push(...this.link('💳 طلبات الشحن', '/wallet'));
    return { permission: 'payments.proofs.review', text, file, buttons };
  }

  private async orderAlert(
    orderId: string | undefined,
    permission: Permission,
    heading: (order: OrderForAlert) => string[],
  ): Promise<StaffAlert | null> {
    const order = await this.loadOrder(orderId);
    if (!order) return null;
    return {
      permission,
      text: clip([...heading(order), describeOrder(order)].join('\n\n')),
      buttons: this.link('🔗 فتح الطلب', `/orders/${order.id}`),
    };
  }

  private async ticketAlert(job: NotificationJob): Promise<StaffAlert | null> {
    if (!job.ticketId) return null;
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: job.ticketId },
      include: {
        customer: true,
        // The customer's own latest words, never an internal staff note.
        messages: { where: { authorType: 'CUSTOMER', internal: false }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!ticket) return null;

    const heading =
      job.kind === 'support.ticket_created'
        ? `🎫 تذكرة دعم جديدة #${ticket.ticketNumber}`
        : `💬 رد جديد من عميل — تذكرة #${ticket.ticketNumber}`;
    const last = ticket.messages[0]?.message ?? ticket.subject;
    return {
      permission: 'support.read',
      text: clip([heading, describeCustomer(ticket.customer), `«${last}»`].join('\n\n')),
      buttons: this.link('💬 رد من لوحة التحكم', `/support/${ticket.id}`),
    };
  }

  private loadOrder(orderId: string | undefined): Promise<OrderForAlert | null> {
    if (!orderId) return Promise.resolve(null);
    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, customer: true, paymentMethod: true },
    });
  }

  private link(text: string, path: string): StaffAlertButton[][] {
    return this.adminUrl ? [[{ text, url: `${this.adminUrl}${path}` }]] : [];
  }
}

function describeCustomer(customer: {
  firstName: string | null;
  lastName: string | null;
  telegramUsername: string | null;
  verifiedAt: Date | null;
}): string {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'بدون اسم';
  const handle = customer.telegramUsername ? ` (@${customer.telegramUsername})` : '';
  const tier = customer.verifiedAt ? '⭐ عميل مميز' : '🆕 عميل عادي';
  return `👤 ${name}${handle} · ${tier}`;
}

function describeOrder(order: OrderForAlert): string {
  const lines = [describeCustomer(order.customer)];

  const items = order.items.slice(0, MAX_ITEM_LINES).map((i) => `📦 ${i.productNameSnapshot} × ${i.quantity}`);
  if (order.items.length > MAX_ITEM_LINES) items.push(`… و${order.items.length - MAX_ITEM_LINES} منتج كمان`);
  lines.push(...items);

  lines.push(`💵 الإجمالي: ${money(order.total, order.currency)}`);
  if (order.memberDiscount.greaterThan(0) && order.memberDiscountKind) {
    lines.push(`🎁 ${MEMBER_DISCOUNT_LABELS[order.memberDiscountKind]}: −${money(order.memberDiscount, order.currency)}`);
  }
  const couponShare = order.discountTotal.sub(order.memberDiscount);
  if (order.couponCode && couponShare.greaterThan(0)) {
    lines.push(`🏷️ كوبون ${order.couponCode}: −${money(couponShare, order.currency)}`);
  }
  if (order.payAmount && order.payCurrency) {
    lines.push(
      `💱 المطلوب تحويله: ${money(order.payAmount, order.payCurrency)}` +
        (order.exchangeRate ? ` (سعر ${order.exchangeRate.toDecimalPlaces(2).toString()})` : ''),
    );
  }
  if (order.paymentMethod) lines.push(`💳 ${order.paymentMethod.name}`);
  return lines.join('\n');
}

function money(amount: Prisma.Decimal, currency: string): string {
  return `${amount.toDecimalPlaces(2).toString()} ${currency}`;
}

function clip(text: string): string {
  return text.length <= CAPTION_LIMIT ? text : `${text.slice(0, CAPTION_LIMIT - 1)}…`;
}
