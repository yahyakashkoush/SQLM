import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AdminProductQueryDto } from './dto/product-query.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';

@Controller('admin/products')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Permissions('products.read')
  list(@Query() query: AdminProductQueryDto) {
    return this.products.listAdmin(query);
  }

  @Get(':id')
  @Permissions('products.read')
  findById(@Param('id') id: string) {
    return this.products.findByIdAdmin(id);
  }

  @Post()
  @Permissions('products.write')
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(':id')
  @Permissions('products.write')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @Permissions('products.write')
  archive(@Param('id') id: string) {
    return this.products.archive(id);
  }
}
