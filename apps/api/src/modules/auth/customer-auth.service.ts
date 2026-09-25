import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { verifyTelegramInitData, TelegramInitDataError } from '@sqlm/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface CustomerAuthResult {
  accessToken: string;
  customer: { id: string; telegramId: string; firstName: string | null; username: string | null };
}

@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async authenticateWithTelegram(initData: string): Promise<CustomerAuthResult> {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new UnauthorizedException('Telegram authentication is not configured');
    }

    let verified;
    try {
      verified = verifyTelegramInitData(initData, botToken);
    } catch (err) {
      if (err instanceof TelegramInitDataError) {
        throw new UnauthorizedException(`Invalid Telegram session: ${err.message}`);
      }
      throw err;
    }

    const { user } = verified;
    const customer = await this.prisma.customer.upsert({
      where: { telegramId: BigInt(user.id) },
      update: {
        telegramUsername: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        languageCode: user.languageCode,
        lastSeenAt: new Date(),
      },
      create: {
        telegramId: BigInt(user.id),
        telegramUsername: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        languageCode: user.languageCode,
        lastSeenAt: new Date(),
      },
    });

    if (customer.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account has been suspended');
    }

    const accessToken = this.jwt.sign(
      { sub: customer.id, type: 'customer' },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: '24h',
      },
    );

    this.logger.log(`Authenticated customer ${customer.id} via Telegram`);
    return {
      accessToken,
      customer: {
        id: customer.id,
        telegramId: customer.telegramId.toString(),
        firstName: customer.firstName,
        username: customer.telegramUsername,
      },
    };
  }
}
