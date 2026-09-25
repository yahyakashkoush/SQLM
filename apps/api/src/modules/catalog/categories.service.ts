import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public: active categories only, ordered for display. */
  async listPublic() {
    return this.prisma.category.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findPublicBySlug(slug: string) {
    const category = await this.prisma.category.findFirst({
      where: { slug, status: 'ACTIVE' },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  /** Staff: every category regardless of status. */
  async listAll() {
    return this.prisma.category.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true, children: true } } },
    });
  }

  async findById(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(dto: CreateCategoryDto) {
    await this.assertSlugAvailable(dto.slug);
    if (dto.parentId) await this.findById(dto.parentId);
    return this.prisma.category.create({ data: dto });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findById(id);
    if (dto.slug) await this.assertSlugAvailable(dto.slug, id);
    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new ConflictException('A category cannot be its own parent');
      }
      await this.findById(dto.parentId);
    }
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  /** Categories are never hard-deleted from under existing products — hide them instead. */
  async archive(id: string) {
    await this.findById(id);
    return this.prisma.category.update({ where: { id }, data: { status: 'HIDDEN' } });
  }

  private async assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.category.findUnique({ where: { slug } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Category slug "${slug}" is already in use`);
    }
  }
}
