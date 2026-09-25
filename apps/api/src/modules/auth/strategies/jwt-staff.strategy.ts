import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedStaff } from '../../rbac/decorators/current-staff.decorator';

interface StaffAccessTokenPayload {
  sub: string;
  type: 'staff';
}

@Injectable()
export class JwtStaffStrategy extends PassportStrategy(Strategy, 'jwt-staff') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: StaffAccessTokenPayload): Promise<AuthenticatedStaff> {
    if (payload.type !== 'staff') {
      throw new UnauthorizedException('Wrong token type');
    }
    const staff = await this.prisma.staff.findUnique({ where: { id: payload.sub } });
    if (!staff || staff.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    return { id: staff.id, email: staff.email, role: staff.role };
  }
}
