import { ConfigService } from '@nestjs/config';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AdminProductQueryDto } from './dto/product-query.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import type { Product } from '@prisma/client';

@Controller('admin/products')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly notifications: NotificationDispatcher,
    private readonly config: ConfigService,
  ) {}

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
  async create(@Body() dto: CreateProductDto) {
    const product = await this.products.create(dto);
    const notified = dto.notifyCustomers ? await this.announce(product) : 0;
    return { ...product, notified };
  }

  @Patch(':id')
  @Permissions('products.write')
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    const product = await this.products.update(id, dto);
    const notified = dto.notifyCustomers ? await this.announce(product) : 0;
    return { ...product, notified };
  }

  @Delete(':id')
  @Permissions('products.write')
  archive(@Param('id') id: string) {
    return this.products.archive(id);
  }

  private async announce(product: Product): Promise<number> {
    if (product.status !== 'ACTIVE' || product.visibility !== 'VISIBLE') return 0;
    const miniAppUrl = this.config.get<string>('MINIAPP_URL', 'http://localhost:3200');
    const lines = [
      `🆕 منتج جديد: ${product.name}`,
      product.shortDescription ?? '',
      `💰 السعر: ${product.price.toString()} ${product.currency}`,
    ].filter(Boolean);
    return this.notifications.broadcastToAllCustomers({
      kind: 'product.new',
      summary: lines.join('\n\n'),
      imageUrl: product.images[0],
      button: { text: '🛒 اطلب الآن', url: `${miniAppUrl}/products/${product.slug}` },
    });
  }
}
