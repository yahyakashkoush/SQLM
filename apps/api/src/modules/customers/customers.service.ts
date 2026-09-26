import { Injectable, NotFoundException } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface TelegramUserInfo {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shared by both customer auth flows: the Mini App's `initData` HMAC
   * verification (Phase 3) and the bot webhook (Phase 7), which is already
   * authenticated by the webhook secret token and needs no further
   * verification of its own. One upsert implementation, so profile fields
   * can't drift depending on which adapter last touched the row.
   */
  async upsertFromTelegram(user: TelegramUserInfo): Promise<Customer> {
    return this.prisma.customer.upsert({
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
  }

  async findById(id: string): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async findByTelegramId(telegramId: number | bigint): Promise<Customer | null> {
    return this.prisma.customer.findUnique({ where: { telegramId: BigInt(telegramId) } });
  }
}
