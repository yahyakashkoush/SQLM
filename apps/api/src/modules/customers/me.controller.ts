import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import { CurrentCustomer, type AuthenticatedCustomer } from '../rbac/decorators/current-customer.decorator';

@Controller('me')
@UseGuards(JwtCustomerAuthGuard)
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  /** Contact details on file and membership — checkout asks for name/phone only when `needsContact`. */
  @Get('profile')
  async profile(@CurrentCustomer() customer: AuthenticatedCustomer) {
    const row = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
      select: { fullName: true, contactPhone: true, wholesaleAt: true, firstName: true, createdAt: true },
    });
    return {
      fullName: row.fullName,
      contactPhone: row.contactPhone,
      needsContact: !row.fullName || !row.contactPhone,
      wholesale: Boolean(row.wholesaleAt),
      firstName: row.firstName,
      memberSince: row.createdAt,
    };
  }
}
