import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    const data = normalizeCryptoFields(dto);
    assertUsableForSettlement(data.provider, data);
    return this.prisma.paymentMethod.create({ data });
  }

  async update(id: string, dto: UpdatePaymentMethodDto) {
    const current = await this.findById(id);
    const data = normalizeCryptoFields(dto);
    // A partial update can turn a manual method into a crypto one, or
    // blank a field the poller needs, so validate the merged result
    // rather than only what this request happened to send.
    assertUsableForSettlement(data.provider ?? current.provider, {
      cryptoAsset: data.cryptoAsset ?? current.cryptoAsset,
      cryptoNetwork: data.cryptoNetwork ?? current.cryptoNetwork,
      depositAddress: data.depositAddress ?? current.depositAddress,
    });
    return this.prisma.paymentMethod.update({ where: { id }, data });
  }

  /** Never hard-deleted — orders reference payment methods historically. Disable instead. */
  async disable(id: string) {
    await this.findById(id);
    return this.prisma.paymentMethod.update({ where: { id }, data: { enabled: false } });
  }
}

/**
 * Exchanges report tickers and chains upper-cased and the poller matches
 * on exact equality, so a method saved as "usdt" would take orders that
 * could never settle. Normalising here makes that unrepresentable.
 */
function normalizeCryptoFields<T extends UpdatePaymentMethodDto>(dto: T): T {
  return {
    ...dto,
    ...(dto.cryptoAsset !== undefined && { cryptoAsset: dto.cryptoAsset.trim().toUpperCase() }),
    ...(dto.cryptoNetwork !== undefined && {
      cryptoNetwork: dto.cryptoNetwork.trim().toUpperCase(),
    }),
    ...(dto.depositAddress !== undefined && { depositAddress: dto.depositAddress.trim() }),
  };
}

function assertUsableForSettlement(
  provider: string | undefined,
  fields: { cryptoAsset?: string | null; cryptoNetwork?: string | null; depositAddress?: string | null },
): void {
  if (!provider || provider === 'MANUAL') return;

  const missing = [
    !fields.cryptoAsset && 'cryptoAsset',
    !fields.cryptoNetwork && 'cryptoNetwork',
    !fields.depositAddress && 'depositAddress',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new BadRequestException(
      `A ${provider} payment method needs ${missing.join(', ')} — without them no deposit can be matched to an order.`,
    );
  }
}
