import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { TelegramBotService } from './telegram-bot.service';

export class UpdateBotProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  shortDescription?: string;
}

@Controller('admin/bot')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminBotController {
  constructor(private readonly bot: TelegramBotService) {}

  @Get()
  @Permissions('settings.read')
  status() {
    return this.bot.getStatus();
  }

  /** Re-registers the webhook, commands and menu button (e.g. after changing domains). */
  @Post('reconnect')
  @Permissions('settings.write')
  reconnect() {
    return this.bot.reconnect();
  }

  @Patch('profile')
  @Permissions('settings.write')
  updateProfile(@Body() dto: UpdateBotProfileDto) {
    return this.bot.updateProfile(dto);
  }
}
