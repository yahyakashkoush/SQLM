import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto';

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public/customer-facing: only what's currently offered at checkout. */
  async listEnabled() {
    return this.prisma.paymentMethod.findMany({
      where: { enabled: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async listAll() {
    return this.prisma.paymentMethod.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string) {
    const method = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundException('Payment method not found');
    return method;
  }

  async create(dto: CreatePaymentMethodDto) {
    return this.prisma.paymentMethod.create({ data: dto });
  }

  async update(id: string, dto: UpdatePaymentMethodDto) {
    await this.findById(id);
    return this.prisma.paymentMethod.update({ where: { id }, data: dto });
  }

  /** Never hard-deleted — orders reference payment methods historically. Disable instead. */
  async disable(id: string) {
    await this.findById(id);
    return this.prisma.paymentMethod.update({ where: { id }, data: { enabled: false } });
  }
}
