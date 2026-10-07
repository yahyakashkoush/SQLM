import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Product } from '@prisma/client';
import type { PaginatedResult } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { slugify, uniqueSlug } from '../../common/utils/slug';
import type { CreateProductDto, ProductBundleDto } from './dto/create-product.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import type { AdminProductQueryDto, ProductQueryDto } from './dto/product-query.dto';

export type PublicProduct = Product & { availableStock: number };

/** Bundles anyone may see. Wholesale bundles are served only to approved members. */
const PUBLIC_BUNDLES = {
  where: { active: true, wholesaleOnly: false },
  orderBy: [{ sortOrder: 'asc' }, { quantity: 'asc' }],
  select: { id: true, label: true, quantity: true, price: true },
} satisfies Prisma.Product$bundlesArgs;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public storefront browse: only ACTIVE + VISIBLE, with live computed stock. */
  async listPublic(query: ProductQueryDto): Promise<PaginatedResult<PublicProduct>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      visibility: 'VISIBLE',
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.featured !== undefined ? { featured: query.featured } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { shortDescription: { contains: query.search, mode: 'insensitive' } },
              { tags: { has: query.search.toLowerCase() } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      query.sort === 'price_asc'
        ? { price: 'asc' }
        : query.sort === 'price_desc'
          ? { price: 'desc' }
          : { createdAt: 'desc' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy,
        include: { bundles: PUBLIC_BUNDLES },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    const withStock = await this.attachAvailableStock(items.map(hideCost));
    return {
      items: withStock,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findPublicBySlug(slug: string): Promise<PublicProduct> {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE', visibility: 'VISIBLE' },
      include: { bundles: PUBLIC_BUNDLES },
    });
    if (!product) throw new NotFoundException('Product not found');
    const [withStock] = await this.attachAvailableStock([hideCost(product)]);
    return withStock!;
  }

  /** Staff catalog management: every status/visibility, paginated + searchable. */
  async listAdmin(query: AdminProductQueryDto): Promise<PaginatedResult<PublicProduct>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.ProductWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          deliveryTemplate: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    const withStock = await this.attachAvailableStock(items);
    return {
      items: withStock,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findByIdAdmin(id: string): Promise<PublicProduct> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { bundles: { orderBy: [{ sortOrder: 'asc' }, { quantity: 'asc' }] } },
    });
    if (!product) throw new NotFoundException('Product not found');
    const [withStock] = await this.attachAvailableStock([product]);
    return withStock!;
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const { notifyCustomers: _notify, bundles, ...data } = dto;
    if (data.slug) await this.assertSlugAvailable(data.slug);
    else data.slug = await uniqueSlug(slugify(data.name), async (slug) =>
      Boolean(await this.prisma.product.findUnique({ where: { slug } })),
    );
    await this.assertReferencesExist(data);
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: data as Prisma.ProductUncheckedCreateInput });
      if (bundles) await this.syncBundles(tx, product.id, bundles);
      return product;
    });
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const { notifyCustomers: _notify, bundles, ...data } = dto;
    await this.findByIdAdmin(id);
    if (data.slug) await this.assertSlugAvailable(data.slug, id);
    await this.assertReferencesExist(data);
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: data as Prisma.ProductUncheckedUpdateInput,
      });
      if (bundles) await this.syncBundles(tx, id, bundles);
      return product;
    });
  }

  /**
   * The form sends the whole list. Order lines keep their own label and
   * price snapshot, so removing a bundle never rewrites history — the
   * foreign key just goes null.
   */
  private async syncBundles(tx: Prisma.TransactionClient, productId: string, bundles: ProductBundleDto[]) {
    const keepIds = bundles.map((b) => b.id).filter((id): id is string => Boolean(id));
    await tx.productBundle.deleteMany({ where: { productId, id: { notIn: keepIds } } });
    for (const [index, bundle] of bundles.entries()) {
      const data = {
        label: bundle.label?.trim() || null,
        quantity: bundle.quantity,
        price: bundle.price,
        wholesaleOnly: bundle.wholesaleOnly ?? false,
        active: bundle.active ?? true,
        sortOrder: index,
      };
      if (bundle.id) {
        const updated = await tx.productBundle.updateMany({ where: { id: bundle.id, productId }, data });
        if (updated.count === 0) throw new NotFoundException('Bundle not found on this product');
      } else {
        await tx.productBundle.create({ data: { ...data, productId } });
      }
    }
  }

  private async assertReferencesExist(dto: {
    categoryId?: string | null;
    deliveryTemplateId?: string | null;
  }): Promise<void> {
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!category) throw new NotFoundException('Category not found');
    }
    if (dto.deliveryTemplateId) {
      const template = await this.prisma.deliveryTemplate.findUnique({
        where: { id: dto.deliveryTemplateId },
      });
      if (!template) throw new NotFoundException('Delivery template not found');
    }
  }

  /**
   * Hard delete, for test products and mistakes. Refused while any order
   * still references the product — the order history would lose what was
   * sold — so the owner deletes those test orders first, or archives.
   * Its inventory goes with it: unsold stock of a product that no longer
   * exists is stock nobody can ever sell.
   */
  async deletePermanently(id: string): Promise<{ id: string; deletedInventory: number }> {
    await this.findByIdAdmin(id);
    const orderLines = await this.prisma.orderItem.count({ where: { productId: id } });
    if (orderLines > 0) {
      throw new ConflictException(
        `This product appears in ${orderLines} order line(s). Delete those orders first, or archive the product instead.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const inventory = await tx.inventoryItem.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
      return { id, deletedInventory: inventory.count };
    });
  }

  /** Products are never hard-deleted once they can be referenced by orders/inventory — archive instead. */
  async archive(id: string): Promise<Product> {
    await this.findByIdAdmin(id);
    return this.prisma.product.update({
      where: { id },
      data: { status: 'ARCHIVED', visibility: 'HIDDEN' },
    });
  }

  /**
   * Batches the "available count" lookup for INDIVIDUAL-mode products into a
   * single grouped query instead of one COUNT per product (N+1). QUANTITY-mode
   * products use their own `stock` column directly — no query needed.
   */
  private async attachAvailableStock(products: Product[]): Promise<PublicProduct[]> {
    const individualIds = products
      .filter((p) => p.inventoryMode === 'INDIVIDUAL')
      .map((p) => p.id);

    const counts =
      individualIds.length > 0
        ? await this.prisma.inventoryItem.groupBy({
            by: ['productId'],
            where: { productId: { in: individualIds }, status: 'AVAILABLE' },
            _count: { _all: true },
          })
        : [];
    const countByProductId = new Map(counts.map((c) => [c.productId, c._count._all]));

    return products.map((product) => ({
      ...product,
      availableStock:
        product.inventoryMode === 'INDIVIDUAL'
          ? (countByProductId.get(product.id) ?? 0)
          : product.stock,
    }));
  }

  private async assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { slug } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Product slug "${slug}" is already in use`);
    }
  }
}

/** Cost price is staff-only margin data; the storefront never gets it. */
function hideCost<T extends Product>(product: T): T {
  return { ...product, costPrice: null };
}
