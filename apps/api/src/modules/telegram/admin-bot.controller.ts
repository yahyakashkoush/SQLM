import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';
import { TelegramBotService } from './telegram-bot.service';
import { STAFF_LINK_PREFIX, StaffTelegramService } from './staff-telegram.service';

export class UpdateStaffTelegramDto {
  @IsBoolean()
  notify!: boolean;
}

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
  constructor(
    private readonly bot: TelegramBotService,
    private readonly staffTelegram: StaffTelegramService,
  ) {}

  // Each staff member manages their own link, so these need no permission
  // beyond being signed in. What a linked account may *do* from Telegram is
  // still decided by its role, at the moment it acts.

  @Get('me')
  myLink(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.staffTelegram.linkStatus(staff.id);
  }

  /**
   * A one-time t.me link that attaches whichever Telegram account opens it
   * to the signed-in staff member. Valid for ten minutes, usable once.
   */
  @Post('me/link')
  async createLink(@CurrentStaff() staff: AuthenticatedStaff) {
    const username = await this.bot.username();
    if (!username) throw new ServiceUnavailableException('The Telegram bot is not connected right now');
    const { token, expiresAt } = await this.staffTelegram.createLinkToken(staff.id);
    return { url: `https://t.me/${username}?start=${STAFF_LINK_PREFIX}${token}`, expiresAt };
  }

  @Patch('me')
  setNotify(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: UpdateStaffTelegramDto) {
    return this.staffTelegram.setNotify(staff.id, dto.notify);
  }

  @Delete('me/link')
  unlink(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.staffTelegram.unlink(staff.id);
  }

  /** Sends a message to the linked chat, to confirm alerts arrive. */
  @Post('me/test')
  async test(@CurrentStaff() staff: AuthenticatedStaff) {
    const telegramId = await this.staffTelegram.telegramIdOf(staff.id);
    if (!telegramId) throw new BadRequestException('Link your Telegram account first');
    await this.bot.sendStaffAlert(telegramId, {
      permission: 'orders.read',
      text: '🔔 تجربة: الإشعارات شغالة. هيوصلك هنا كل طلب جديد وكل إثبات دفع بزرار قبول/رفض.',
      buttons: [],
    });
    return { sent: true };
  }

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
