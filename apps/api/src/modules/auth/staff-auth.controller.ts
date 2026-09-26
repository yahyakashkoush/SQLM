import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StaffAuthService } from './staff-auth.service';
import { StaffLoginDto } from './dto/staff-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';

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
