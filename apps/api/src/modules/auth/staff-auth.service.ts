import { randomBytes, createHash } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import ms from 'ms';
import { PrismaService } from '../prisma/prisma.service';
import type { StaffLoginDto } from './dto/staff-login.dto';

export interface StaffTokenPair {
  accessToken: string;
  refreshToken: string;
  staff: { id: string; email: string; name: string; role: string };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: StaffLoginDto): Promise<StaffTokenPair> {
    const staff = await this.prisma.staff.findUnique({ where: { email: dto.email } });
    // Constant-shape failure path: verify against a dummy hash when the
    // account doesn't exist, so login timing doesn't reveal which emails
    // are registered.
    const passwordHash = staff?.passwordHash ?? (await argon2.hash('not-a-real-account'));
    const passwordOk = await argon2.verify(passwordHash, dto.password).catch(() => false);

    if (!staff || staff.status !== 'ACTIVE' || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokenPair(staff.id, staff.email, staff.name, staff.role);
  }

  async refresh(refreshToken: string): Promise<StaffTokenPair> {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.staffRefreshToken.findUnique({
      where: { tokenHash },
      include: { staff: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.staff.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.staffRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair(stored.staff.id, stored.staff.email, stored.staff.name, stored.staff.role);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.staffRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokenPair(
    staffId: string,
    email: string,
    name: string,
    role: string,
  ): Promise<StaffTokenPair> {
    const accessToken = this.jwt.sign(
      { sub: staffId, type: 'staff' },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '15m'),
      },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '30d');
    await this.prisma.staffRefreshToken.create({
      data: {
        staffId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + ms(refreshTtl)),
      },
    });

    this.logger.log(`Issued token pair for staff ${staffId}`);
    return { accessToken, refreshToken, staff: { id: staffId, email, name, role } };
  }
}
