import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import { CurrentCustomer } from '../rbac/decorators/current-customer.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('notifications')
@UseGuards(JwtCustomerAuthGuard)
export class CustomerNotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentCustomer() customer: { id: string }) {
    return this.prisma.customerNotification.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentCustomer() customer: { id: string }) {
    const count = await this.prisma.customerNotification.count({
      where: { customerId: customer.id, isRead: false },
    });
    return { count };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@CurrentCustomer() customer: { id: string }, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.prisma.customerNotification.updateMany({
      where: { id, customerId: customer.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllRead(@CurrentCustomer() customer: { id: string }): Promise<void> {
    await this.prisma.customerNotification.updateMany({
      where: { customerId: customer.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }
}
