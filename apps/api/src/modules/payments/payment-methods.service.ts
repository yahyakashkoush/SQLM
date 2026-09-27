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

  assertAddressMatchesNetwork(fields.cryptoNetwork!, fields.depositAddress!);
}

/**
 * Address shapes that are unambiguous enough to reject on.
 *
 * Switching the network dropdown without replacing the address is the one
 * mistake here that destroys money rather than just failing: funds sent to
 * an address that is valid on a different chain are usually unrecoverable.
 * Nothing downstream can catch it — the poller only ever sees deposits that
 * did arrive — so it has to be caught before the method is saved.
 *
 * Only clear mismatches are rejected. A chain whose format this does not
 * know is left to the operator, since a wrong guess here would block a
 * legitimate address.
 */
const ADDRESS_SHAPES: Record<string, { pattern: RegExp; describe: string }> = {
  ETH: { pattern: /^0x[0-9a-fA-F]{40}$/, describe: '0x followed by 40 hex characters' },
  BSC: { pattern: /^0x[0-9a-fA-F]{40}$/, describe: '0x followed by 40 hex characters' },
  MATIC: { pattern: /^0x[0-9a-fA-F]{40}$/, describe: '0x followed by 40 hex characters' },
  ARBITRUM: { pattern: /^0x[0-9a-fA-F]{40}$/, describe: '0x followed by 40 hex characters' },
  TRX: { pattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, describe: 'T followed by 33 base58 characters' },
  SOL: { pattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, describe: '32-44 base58 characters, never 0x' },
  TON: { pattern: /^[EU]Q[0-9A-Za-z_-]{46}$/, describe: 'EQ or UQ followed by 46 characters' },
};

function assertAddressMatchesNetwork(network: string, address: string): void {
  const shape = ADDRESS_SHAPES[network];
  if (!shape || shape.pattern.test(address)) return;

  throw new BadRequestException(
    `That deposit address is not a valid ${network} address (expected ${shape.describe}). ` +
      'Copy the address Binance or Bybit shows for this exact asset and network — a deposit ' +
      'sent to an address from a different chain is normally lost for good.',
  );
}
