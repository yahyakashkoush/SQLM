import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CreateDeliveryTemplateDto, UpdateDeliveryTemplateDto } from './dto/delivery-template.dto';

@Controller('admin/delivery-templates')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class DeliveryTemplatesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Permissions('delivery.read')
  list() {
    return this.prisma.deliveryTemplate.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  @Post()
  @Permissions('products.write')
  create(@Body() dto: CreateDeliveryTemplateDto) {
    return this.prisma.deliveryTemplate.create({ data: dto });
  }

  @Patch(':id')
  @Permissions('products.write')
  async update(@Param('id') id: string, @Body() dto: UpdateDeliveryTemplateDto) {
    await this.findOrThrow(id);
    return this.prisma.deliveryTemplate.update({ where: { id }, data: dto });
  }

  /** Products using it fall back to no template (FK is ON DELETE SET NULL). */
  @Delete(':id')
  @Permissions('products.write')
  async remove(@Param('id') id: string) {
    await this.findOrThrow(id);
    await this.prisma.deliveryTemplate.delete({ where: { id } });
    return { deleted: true };
  }

  private async findOrThrow(id: string) {
    const template = await this.prisma.deliveryTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Delivery template not found');
    return template;
  }
}
