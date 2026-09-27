import { Injectable, Logger } from '@nestjs/common';
import type { PaymentProvider } from '@prisma/client';
import { ExchangeClient } from './exchange-client';
import { BinanceClient } from './binance.client';
import { BybitClient } from './bybit.client';

/** Looks up the client for a provider and reports which ones have keys. */
@Injectable()
export class ExchangeRegistry {
  private readonly logger = new Logger(ExchangeRegistry.name);
  private readonly clients: ExchangeClient[];

  constructor(binance: BinanceClient, bybit: BybitClient) {
    this.clients = [binance, bybit];
    const configured = this.configuredProviders();
    this.logger.log(
      configured.length > 0
        ? `Crypto auto-settlement enabled for: ${configured.join(', ')}`
        : 'No exchange API keys configured — crypto payment methods will not auto-settle.',
    );
  }

  get(provider: PaymentProvider): ExchangeClient | undefined {
    return this.clients.find((client) => client.provider === provider);
  }

  /** Only these are polled; a method on an unconfigured provider is inert. */
  configured(): ExchangeClient[] {
    return this.clients.filter((client) => client.isConfigured());
  }

  configuredProviders(): PaymentProvider[] {
    return this.configured().map((client) => client.provider);
  }

  isConfigured(provider: PaymentProvider): boolean {
    return this.get(provider)?.isConfigured() ?? false;
  }
}
