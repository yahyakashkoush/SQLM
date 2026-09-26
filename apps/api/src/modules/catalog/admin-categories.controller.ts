import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';

@Controller('admin/categories')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Permissions('categories.read')
  list() {
    return this.categories.listAll();
  }

  @Get(':id')
  @Permissions('categories.read')
  findById(@Param('id') id: string) {
    return this.categories.findById(id);
  }

  @Post()
  @Permissions('categories.write')
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @Permissions('categories.write')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @Permissions('categories.write')
  archive(@Param('id') id: string) {
    return this.categories.archive(id);
  }
}
