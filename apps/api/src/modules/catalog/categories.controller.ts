import { Controller, Get, Param } from '@nestjs/common';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list() {
    return this.categories.listPublic();
  }

  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.categories.findPublicBySlug(slug);
  }
}
