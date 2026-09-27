import type { PaymentProvider } from '@prisma/client';

/** Every provider that is actually an exchange — MANUAL is not one. */
export type ExchangeProvider = Exclude<PaymentProvider, 'MANUAL'>;

/**
 * One deposit as the poller cares about it, normalised across exchanges.
 *
 * Only deposits the exchange considers final appear here — a client drops
 * pending and failed records rather than passing them up with a flag,
 * because a deposit that later fails must never have settled an order.
 */
export interface ExchangeDeposit {
  /** The exchange's transaction id. Unique per provider, the dedup key. */
  txId: string;
  /** Ticker, upper-cased, e.g. "USDT". */
  asset: string;
  /** Exchange network code, upper-cased, e.g. "TRX". */
  network: string;
  /** Exact amount credited, as the exchange reported it. Kept a string so
   *  no float rounding happens between the API and the Decimal column. */
  amount: string;
  address?: string;
  /** The provider's own status value, kept for support triage. */
  rawStatus?: string;
  creditedAt?: Date;
}

export interface ExchangeClient {
  readonly provider: ExchangeProvider;
  /** False when no API key is configured; the poller then skips it. */
  isConfigured(): boolean;
  /** Completed deposits credited at or after `since`. */
  listDeposits(since: Date): Promise<ExchangeDeposit[]>;
}

/** Surfaces which exchange failed without leaking the key into the message. */
export class ExchangeRequestError extends Error {
  constructor(
    readonly provider: ExchangeProvider,
    message: string,
    readonly status?: number,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ExchangeRequestError';
  }
}
