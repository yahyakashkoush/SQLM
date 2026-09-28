import { Injectable } from '@nestjs/common';
import { Prisma, type Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductNotPurchasableError } from './errors/order.errors';

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface PricedCart {
  currency: string;
  subtotal: Prisma.Decimal;
  productById: Map<string, Product>;
}

/**
 * Turns a list of product ids and quantities into money, from the database
 * every time.
 *
 * Extracted from checkout so the coupon quote endpoint prices the identical
 * cart the identical way. A subtotal posted by the client is a number the
 * client can edit, and quoting a percentage against it would let anyone
 * claim any discount they liked; both paths going through here is what
 * makes the quoted total and the charged total the same number.
 */
@Injectable()
export class CartPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async priceCart(items: CartLine[]): Promise<PricedCart> {
    if (items.length === 0) {
      throw new ProductNotPurchasableError('(empty cart)');
    }

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    const productById = new Map(products.map((p) => [p.id, p]));

    let currency: string | undefined;
    let subtotal = new Prisma.Decimal(0);

    for (const item of items) {
      const product = productById.get(item.productId);
      if (!product || product.status !== 'ACTIVE' || product.visibility !== 'VISIBLE') {
        throw new ProductNotPurchasableError(item.productId);
      }
      // One order, one currency: a mixed cart has no meaningful total.
      if (currency && currency !== product.currency) {
        throw new ProductNotPurchasableError(item.productId);
      }
      currency = product.currency;
      subtotal = subtotal.add(product.price.mul(item.quantity));
    }

    return { currency: currency!, subtotal, productById };
  }

  async subtotalFor(items: CartLine[]): Promise<Prisma.Decimal> {
    const { subtotal } = await this.priceCart(items);
    return subtotal;
  }
}
