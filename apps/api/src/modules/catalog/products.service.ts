import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Product } from '@prisma/client';
import type { PaginatedResult } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProductDto } from './dto/create-product.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import type { AdminProductQueryDto, ProductQueryDto } from './dto/product-query.dto';

export type PublicProduct = Product & { availableStock: number };

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

  async findPublicBySlug(slug: string): Promise<PublicProduct> {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE', visibility: 'VISIBLE' },
    });
    if (!product) throw new NotFoundException('Product not found');
    const [withStock] = await this.attachAvailableStock([product]);
    return withStock!;
  }

  /** Staff catalog management: every status/visibility, paginated + searchable. */
  async listAdmin(query: AdminProductQueryDto): Promise<PaginatedResult<PublicProduct>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.ProductWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
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
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    const [withStock] = await this.attachAvailableStock([product]);
    return withStock!;
  }

  async create(dto: CreateProductDto): Promise<Product> {
    await this.assertSlugAvailable(dto.slug);
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!category) throw new NotFoundException('Category not found');
    }
    return this.prisma.product.create({ data: dto as Prisma.ProductUncheckedCreateInput });
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    await this.findByIdAdmin(id);
    if (dto.slug) await this.assertSlugAvailable(dto.slug, id);
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!category) throw new NotFoundException('Category not found');
    }
    return this.prisma.product.update({
      where: { id },
      data: dto as Prisma.ProductUncheckedUpdateInput,
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
