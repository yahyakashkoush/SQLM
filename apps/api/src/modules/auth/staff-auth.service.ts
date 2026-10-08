import { randomBytes, createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { verifyTelegramInitData, TelegramInitDataError } from '@sqlm/shared/crypto';
import { StaffIdentityService } from '../staff-identity/staff-identity.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import ms from 'ms';
import { PrismaService } from '../prisma/prisma.service';
import { TotpService } from './totp.service';
import type { StaffLoginDto } from './dto/staff-login.dto';

export interface StaffTokenPair {
  accessToken: string;
  refreshToken: string;
  staff: { id: string; email: string; name: string; role: string };
}

/** Issued when password succeeds but TOTP is still required. */
export interface StaffPartialToken {
  requires2fa: true;
  /** Short-lived token the client echoes back with the TOTP code. */
  partialToken: string;
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
    private readonly totp: TotpService,
    private readonly identity: StaffIdentityService,
  ) {}

  /**
   * Sign-in for the Mini App's admin mode. The Telegram session must be
   * signed by our bot and under an hour old, and the account must be one
   * the bot already treats as staff (linked from the dashboard, or in
   * TELEGRAM_ADMIN_IDS). The tokens carry the same role and permissions as
   * a dashboard login, so every admin endpoint applies its usual guards.
   */
  async loginWithTelegram(initData: string): Promise<StaffTokenPair> {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) throw new UnauthorizedException('Telegram authentication is not configured');
    let telegramUserId: number;
    try {
      telegramUserId = verifyTelegramInitData(initData, botToken, 3600).user.id;
    } catch (err) {
      if (err instanceof TelegramInitDataError) throw new UnauthorizedException(`Invalid Telegram session: ${err.message}`);
      throw err;
    }
    const staff = await this.identity.resolve(telegramUserId);
    if (!staff) throw new ForbiddenException({ code: 'NOT_STAFF', message: 'This Telegram account is not linked to a staff member' });
    await this.prisma.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
    await this.prisma.auditLog.create({
      data: {
        actorStaffId: staff.id,
        action: 'staff.login_telegram',
        entityType: 'staff',
        entityId: staff.id,
        changes: { telegramUserId: String(telegramUserId) },
      },
    });
    return this.issueTokenPair(staff.id, staff.email, staff.name, staff.role);
  }

  async login(dto: StaffLoginDto): Promise<StaffTokenPair | StaffPartialToken> {
    const staff = await this.prisma.staff.findUnique({ where: { email: dto.email } });
    // Constant-shape failure path: verify against a dummy hash when the
    // account doesn't exist, so login timing doesn't reveal which emails
    // are registered.
    const passwordHash = staff?.passwordHash ?? (await argon2.hash('not-a-real-account'));
    const passwordOk = await argon2.verify(passwordHash, dto.password).catch(() => false);

    if (!staff || staff.status !== 'ACTIVE' || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // If TOTP is enabled, issue a short-lived partial token instead of full tokens.
    if (staff.totpEnabled && staff.totpSecret) {
      const partialToken = this.jwt.sign(
        { sub: staff.id, type: 'staff-2fa-pending' },
        {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          expiresIn: '5m',
        },
      );
      return { requires2fa: true, partialToken };
    }

    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokenPair(staff.id, staff.email, staff.name, staff.role);
  }

  /** Second step: exchange partial token + TOTP code for a real session. */
  async verifyLogin(partialToken: string, code: string): Promise<StaffTokenPair> {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwt.verify(partialToken, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }) as typeof payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired partial token');
    }
    if (payload.type !== 'staff-2fa-pending') throw new UnauthorizedException('Invalid token type');

    const staff = await this.prisma.staff.findUnique({ where: { id: payload.sub } });
    if (!staff || staff.status !== 'ACTIVE' || !staff.totpEnabled || !staff.totpSecret) {
      throw new UnauthorizedException('Account not eligible for 2FA verification');
    }
    this.totp.assertValid(staff.totpSecret, code);

    await this.prisma.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokenPair(staff.id, staff.email, staff.name, staff.role);
  }

  /** Generate a new TOTP secret and return the URI for QR display. Does NOT activate 2FA yet. */
  async setup2fa(staffId: string): Promise<{ secret: string; uri: string }> {
    const secret = this.totp.generateSecret();
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: staffId }, select: { email: true } });
    await this.prisma.staff.update({ where: { id: staffId }, data: { totpSecret: secret, totpEnabled: false } });
    const uri = this.totp.otpauthUri(staff.email, secret);
    return { secret, uri };
  }

  /** Confirm first valid TOTP code — activates 2FA enforcement. */
  async activate2fa(staffId: string, code: string): Promise<void> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: staffId }, select: { totpSecret: true } });
    if (!staff.totpSecret) throw new BadRequestException('Run setup first');
    this.totp.assertValid(staff.totpSecret, code);
    await this.prisma.staff.update({ where: { id: staffId }, data: { totpEnabled: true } });
  }

  /** Disable TOTP for the given staff member (requires current TOTP code). */
  async disable2fa(staffId: string, code: string): Promise<void> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: staffId }, select: { totpSecret: true, totpEnabled: true } });
    if (!staff.totpEnabled || !staff.totpSecret) return;
    this.totp.assertValid(staff.totpSecret, code);
    await this.prisma.staff.update({ where: { id: staffId }, data: { totpEnabled: false, totpSecret: null } });
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
