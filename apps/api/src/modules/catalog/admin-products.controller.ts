import { ConfigService } from '@nestjs/config';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateBundleDto, UpdateBundleDto } from './dto/bundle.dto';
import { AdminProductQueryDto } from './dto/product-query.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import type { Product } from '@prisma/client';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';
import { AuditService } from '../audit/audit.service';

@Controller('admin/products')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly notifications: NotificationDispatcher,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
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

  @Get(':id/bundles')
  @Permissions('products.read')
  bundles(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.listBundles(id);
  }

  @Post(':id/bundles')
  @Permissions('products.write')
  async addBundle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBundleDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    const result = await this.products.addBundle(id, dto);
    await this.auditBundle(staff, 'product.bundle_added', id, { bundleId: result.bundle.id, ...dto });
    return result;
  }

  @Patch(':id/bundles/:bundleId')
  @Permissions('products.write')
  async updateBundle(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Body() dto: UpdateBundleDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    const result = await this.products.updateBundle(id, bundleId, dto);
    await this.auditBundle(staff, 'product.bundle_updated', id, { bundleId, ...dto });
    return result;
  }

  @Delete(':id/bundles/:bundleId')
  @Permissions('products.write')
  async deleteBundle(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    const result = await this.products.deleteBundle(id, bundleId);
    await this.auditBundle(staff, 'product.bundle_deleted', id, { bundleId });
    return result;
  }

  private auditBundle(staff: AuthenticatedStaff, action: string, productId: string, changes: object) {
    return this.audit.log({
      actorStaffId: staff.id,
      action,
      entityType: 'product',
      entityId: productId,
      changes: JSON.parse(JSON.stringify(changes)),
    });
  }

  @Delete(':id')
  @Permissions('products.write')
  archive(@Param('id') id: string) {
    return this.products.archive(id);
  }

  /** Gone for good, with its inventory. Only for products no order references. */
  @Delete(':id/permanent')
  @Permissions('products.delete')
  async deletePermanently(@Param('id') id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    const result = await this.products.deletePermanently(id);
    await this.audit.log({
      actorStaffId: staff.id,
      action: 'product.deleted',
      entityType: 'product',
      entityId: id,
      changes: { deletedInventory: result.deletedInventory },
    });
    return result;
  }

  private async announce(product: Product): Promise<number> {
    if (product.status !== 'ACTIVE' || product.visibility !== 'VISIBLE') return 0;
    const miniAppUrl = this.config.get<string>('MINIAPP_URL', 'http://localhost:3200');
    const lines = [
      `🆕 منتج جديد: ${product.name}`,
      product.shortDescription ?? '',
      `💰 السعر: ${product.price.toString()} ${product.currency}`,
    ].filter(Boolean);
    return this.notifications.broadcastToCustomers({
      kind: 'product.new',
      summary: lines.join('\n\n'),
      imageUrl: product.images[0],
      button: { text: '🛒 اطلب الآن', url: `${miniAppUrl}/products/${product.slug}` },
    });
  }
}
