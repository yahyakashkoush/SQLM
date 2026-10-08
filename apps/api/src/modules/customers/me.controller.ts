import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StaffIdentityService } from '../staff-identity/staff-identity.service';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import { CurrentCustomer, type AuthenticatedCustomer } from '../rbac/decorators/current-customer.decorator';

@Controller('me')
@UseGuards(JwtCustomerAuthGuard)
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly identity: StaffIdentityService,
  ) {}

  /** Contact details on file and membership — checkout asks for name/phone only when `needsContact`. */
  @Get('profile')
  async profile(@CurrentCustomer() customer: AuthenticatedCustomer) {
    const row = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
      select: { fullName: true, contactPhone: true, wholesaleAt: true, firstName: true, createdAt: true, walletBalance: true },
    });
    const [currency, staff] = await Promise.all([
      row.wholesaleAt ? this.settings.getString('store.defaultCurrency') : Promise.resolve(null),
      this.identity.resolve(customer.telegramId),
    ]);
    return {
      fullName: row.fullName,
      contactPhone: row.contactPhone,
      needsContact: !row.fullName || !row.contactPhone,
      wholesale: Boolean(row.wholesaleAt),
      firstName: row.firstName,
      memberSince: row.createdAt,
      /** Merchants only: their prepaid balance. */
      wallet: row.wholesaleAt ? { balance: row.walletBalance.toFixed(2), currency } : null,
      /** This Telegram account is staff: the Mini App shows its admin mode. */
      staff: staff ? { role: staff.role, name: staff.name } : null,
    };
  }
}
