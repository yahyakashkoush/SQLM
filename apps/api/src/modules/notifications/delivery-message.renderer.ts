import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { renderTemplate } from '@sqlm/shared';
import { decryptSecret } from '@sqlm/shared/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** Builds the customer's "your order is delivered" Telegram message from the configured template. */
@Injectable()
export class DeliveryMessageRenderer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  /** Returns null when the delivery is gone or not delivered yet. */
  async render(deliveryId: string): Promise<string | null> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        order: { include: { customer: true } },
        orderItem: { include: { product: { include: { deliveryTemplate: true } } } },
      },
    });
    if (!delivery || delivery.status !== 'DELIVERED') return null;

    const sendContent = await this.settings.getBoolean('delivery.sendContentInTelegram');
    const content =
      sendContent && delivery.encryptedContent
        ? decryptSecret(delivery.encryptedContent, this.config.getOrThrow<string>('INVENTORY_ENCRYPTION_KEY'))
        : '🔒 افتح صفحة الطلب في التطبيق لعرض البيانات.';

    const product = delivery.orderItem.product;
    const template =
      product.deliveryTemplate?.message?.trim() || (await this.settings.getString('delivery.message'));

    return renderTemplate(template, {
      ...(await this.settings.storeValues()),
      order_number: delivery.order.sequenceNumber,
      product_name: delivery.orderItem.productNameSnapshot,
      quantity: delivery.orderItem.quantity,
      content,
      instructions: product.activationInstructions ? `📝 ${product.activationInstructions}` : '',
      warranty: product.warranty ?? '',
      duration: product.duration ?? '',
      customer_name: delivery.order.customer.firstName ?? '',
    });
  }
}
