import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { StaffAuthService } from './staff-auth.service';
import { StaffLoginDto } from './dto/staff-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';

class Verify2faDto {
  @IsString() partialToken!: string;
  @IsString() @Length(6, 6) code!: string;
}

class Totp2faCodeDto {
  @IsString() @Length(6, 6) code!: string;
}

@Controller('auth/staff')
export class StaffAuthController {
  constructor(private readonly staffAuth: StaffAuthService) {}

  /** Tighter than the global default — this is the platform's #1 brute-force target. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: {} })
  login(@Body() dto: StaffLoginDto) {
    return this.staffAuth.login(dto);
  }

  /** The Mini App's admin mode: a staff Telegram account signs in with its initData. */
  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: {} })
  loginWithTelegram(@Body() dto: TelegramAuthDto) {
    return this.staffAuth.loginWithTelegram(dto.initData);
  }

  /** Second step when login returns `requires2fa: true`. */
  @Post('2fa/verify-login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: {} })
  verifyLogin(@Body() dto: Verify2faDto) {
    return this.staffAuth.verifyLogin(dto.partialToken, dto.code);
  }

  /** Generate TOTP secret + QR URI. Must be followed by /2fa/activate. */
  @Post('2fa/setup')
  @UseGuards(JwtStaffAuthGuard)
  setup2fa(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.staffAuth.setup2fa(staff.id);
  }

  /** Activate 2FA after confirming the first code from the authenticator. */
  @Post('2fa/activate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtStaffAuthGuard)
  async activate2fa(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: Totp2faCodeDto): Promise<void> {
    await this.staffAuth.activate2fa(staff.id, dto.code);
  }

  /** Disable 2FA (requires current TOTP code as proof). */
  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtStaffAuthGuard)
  async disable2fa(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: Totp2faCodeDto): Promise<void> {
    await this.staffAuth.disable2fa(staff.id, dto.code);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.staffAuth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.staffAuth.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtStaffAuthGuard)
  me(@CurrentStaff() staff: AuthenticatedStaff) {
    return staff;
  }
}
