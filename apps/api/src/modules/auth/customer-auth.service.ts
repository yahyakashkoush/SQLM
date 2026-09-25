import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { verifyTelegramInitData, TelegramInitDataError } from '@sqlm/shared';
import { CustomersService } from '../customers/customers.service';

export interface CustomerAuthResult {
  accessToken: string;
  customer: { id: string; telegramId: string; firstName: string | null; username: string | null };
}

@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    private readonly customers: CustomersService,
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

    const customer = await this.customers.upsertFromTelegram(verified.user);

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
