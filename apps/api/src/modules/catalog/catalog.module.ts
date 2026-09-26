import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { AdminCategoriesController } from './admin-categories.controller';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { AdminProductsController } from './admin-products.controller';

@Module({
  controllers: [
    CategoriesController,
    AdminCategoriesController,
    ProductsController,
    AdminProductsController,
  ],
  providers: [CategoriesService, ProductsService],
  exports: [CategoriesService, ProductsService],
})
export class CatalogModule {}
