import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SupportService } from './support.service';
import { AddTicketMessageDto, CreateTicketDto, TicketQueryDto } from './dto/ticket.dto';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import {
  CurrentCustomer,
  type AuthenticatedCustomer,
} from '../rbac/decorators/current-customer.decorator';

@Controller('support/tickets')
@UseGuards(JwtCustomerAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: CreateTicketDto) {
    return this.support.createTicket(customer.id, dto);
  }

  @Get()
  list(@CurrentCustomer() customer: AuthenticatedCustomer, @Query() query: TicketQueryDto) {
    return this.support.listForCustomer(customer.id, query);
  }

  @Get('unread-count')
  unread(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.support.unreadCounts({ type: 'CUSTOMER', customerId: customer.id });
  }

  @Get(':id')
  thread(@Param('id') id: string, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.support.getThread(id, { type: 'CUSTOMER', customerId: customer.id });
  }

  @Post(':id/messages')
  reply(
    @Param('id') id: string,
    @Body() dto: AddTicketMessageDto,
    @CurrentCustomer() customer: AuthenticatedCustomer,
  ) {
    // `internal` is staff-only and is ignored here by construction.
    return this.support.addMessage(id, { type: 'CUSTOMER', customerId: customer.id }, dto.message);
  }
}
