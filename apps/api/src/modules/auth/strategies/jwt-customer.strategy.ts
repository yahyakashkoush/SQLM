import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedCustomer } from '../../rbac/decorators/current-customer.decorator';

interface CustomerAccessTokenPayload {
  sub: string;
  type: 'customer';
}

@Injectable()
export class JwtCustomerStrategy extends PassportStrategy(Strategy, 'jwt-customer') {
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

  async validate(payload: CustomerAccessTokenPayload): Promise<AuthenticatedCustomer> {
    if (payload.type !== 'customer') {
      throw new UnauthorizedException('Wrong token type');
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: payload.sub } });
    if (!customer || customer.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    return { id: customer.id, telegramId: customer.telegramId.toString() };
  }
}
