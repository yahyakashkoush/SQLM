import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { renderTemplate } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { normalizeContactPhone } from '../orders/orders.service';
import type { ApplyWholesaleDto } from './wholesale.dto';

@Injectable()
export class WholesaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  /** What the Mini App's wholesale page needs in one call. */
  async statusFor(customerId: string) {
    const [customer, latest, enabled, terms, values] = await Promise.all([
      this.prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { wholesaleAt: true } }),
      this.prisma.wholesaleApplication.findFirst({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, staffNote: true, createdAt: true, reviewedAt: true },
      }),
      this.settings.getBoolean('wholesale.enabled'),
      this.settings.getString('wholesale.terms'),
      this.settings.storeValues(),
    ]);
    return {
      member: Boolean(customer.wholesaleAt),
      memberSince: customer.wholesaleAt,
      accepting: enabled,
      terms: renderTemplate(terms, values),
      application: latest,
    };
  }

  async apply(customerId: string, dto: ApplyWholesaleDto) {
    if (!dto.acceptTerms) throw new BadRequestException('لازم توافق على شروط العضوية.');
    if (!(await this.settings.getBoolean('wholesale.enabled'))) {
      throw new BadRequestException('طلبات عضوية الجملة مقفولة حالياً.');
    }
    const phone = normalizeContactPhone(dto.contactPhone);
    if (!phone) throw new BadRequestException('اكتب رقم موبايل صحيح.');

    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { wholesaleAt: true, firstName: true, telegramUsername: true },
    });
    if (customer.wholesaleAt) throw new ConflictException('انت عضو جملة بالفعل.');
    const pending = await this.prisma.wholesaleApplication.findFirst({ where: { customerId, status: 'PENDING' } });
    if (pending) throw new ConflictException('طلبك قيد المراجعة بالفعل.');

    const application = await this.prisma.wholesaleApplication.create({
      data: {
        customerId,
        businessName: dto.businessName.trim(),
        contactPhone: phone,
        monthlyVolume: dto.monthlyVolume?.trim() || null,
        notes: dto.notes?.trim() || null,
        termsAcceptedAt: new Date(),
      },
    });
    await this.notifications.notifyStaff({
      kind: 'wholesale.applied',
      applicationId: application.id,
      customerId,
      summary: `🏪 طلب عضوية جملة — ${application.businessName}`,
      body: [
        `العميل: ${customer.firstName ?? '—'}${customer.telegramUsername ? ` (@${customer.telegramUsername})` : ''}`,
        `الموبايل: ${phone}`,
        application.monthlyVolume ? `الكمية الشهرية: ${application.monthlyVolume}` : '',
        application.notes ? `ملاحظات: ${application.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    return application;
  }

  /** Wholesale-only bundles of one product, for an approved member. */
  async bundlesFor(customerId: string, productId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { wholesaleAt: true },
    });
    if (!customer.wholesaleAt) return [];
    return this.prisma.productBundle.findMany({
      where: {
        productId,
        active: true,
        wholesaleOnly: true,
        product: { status: 'ACTIVE', visibility: 'VISIBLE' },
      },
      orderBy: [{ sortOrder: 'asc' }, { quantity: 'asc' }],
      select: { id: true, label: true, quantity: true, price: true, wholesaleOnly: true },
    });
  }

  /** Every product that has wholesale bundles, with them — the member's price list. */
  async catalogFor(customerId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { wholesaleAt: true },
    });
    if (!customer.wholesaleAt) return [];
    return this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        bundles: { some: { active: true, wholesaleOnly: true } },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        images: true,
        currency: true,
        price: true,
        bundles: {
          where: { active: true, wholesaleOnly: true },
          orderBy: [{ sortOrder: 'asc' }, { quantity: 'asc' }],
          select: { id: true, label: true, quantity: true, price: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------

  list(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.prisma.wholesaleApplication.findMany({
      where: status ? { status } : {},
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true, telegramUsername: true, wholesaleAt: true },
        },
        reviewedBy: { select: { name: true } },
      },
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 200,
    });
  }

  async review(applicationId: string, staffId: string, approve: boolean, note?: string) {
    const staffNote = note?.trim().slice(0, 500) || null;
    const claimed = await this.prisma.wholesaleApplication.updateMany({
      where: { id: applicationId, status: 'PENDING' },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        staffNote,
        reviewedById: staffId,
        reviewedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new ConflictException('الطلب ده اتراجع خلاص.');
    const application = await this.prisma.wholesaleApplication.findUniqueOrThrow({ where: { id: applicationId } });

    if (approve) {
      await this.prisma.customer.update({
        where: { id: application.customerId },
        data: { wholesaleAt: new Date() },
      });
    }
    await this.audit.log({
      actorStaffId: staffId,
      action: approve ? 'wholesale.approved' : 'wholesale.rejected',
      entityType: 'customer',
      entityId: application.customerId,
      changes: { applicationId, note: staffNote },
    });
    await this.notifications.notifyCustomer(application.customerId, {
      kind: 'wholesale.reviewed',
      summary: approve
        ? '🏪 مبروك! اتقبلت عضويتك كتاجر جملة. أسعار الجملة ظهرت ليك على باقات المنتجات في المتجر.'
        : '❌ للأسف طلب عضوية الجملة اترفض.',
      body: staffNote ? `ملاحظة الإدارة: ${staffNote}` : undefined,
    });
    return application;
  }

  async revoke(customerId: string, staffId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    await this.prisma.customer.update({ where: { id: customerId }, data: { wholesaleAt: null } });
    await this.audit.log({
      actorStaffId: staffId,
      action: 'wholesale.revoked',
      entityType: 'customer',
      entityId: customerId,
    });
  }
}
