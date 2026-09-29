import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { ExchangeClient, ExchangeDeposit, ExchangeRequestError } from './exchange-client';
import { withTimeout } from '../../../common/utils/with-timeout';

/** Binance deposit `status`: 1 is the only one that means credited and final. */
const STATUS_SUCCESS = 1;
const REQUEST_TIMEOUT_MS = 15_000;

interface BinanceDepositRecord {
  amount?: string;
  coin?: string;
  network?: string;
  status?: number;
  address?: string;
  txId?: string;
  insertTime?: number;
}

/**
 * Reads deposit history from Binance with a signed SAPI request.
 *
 * Needs only the "Enable Reading" permission. Nothing here can move funds,
 * so a key scoped that way is inert if this host is ever compromised.
 */
@Injectable()
export class BinanceClient implements ExchangeClient {
  readonly provider = 'BINANCE' as const;
  private readonly logger = new Logger(BinanceClient.name);
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('BINANCE_API_KEY');
    this.apiSecret = config.get<string>('BINANCE_API_SECRET');
    this.baseUrl = config.get<string>('BINANCE_API_BASE_URL') ?? 'https://api.binance.com';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  async listDeposits(since: Date): Promise<ExchangeDeposit[]> {
    if (!this.apiKey || !this.apiSecret) return [];

    const params = new URLSearchParams({
      startTime: String(since.getTime()),
      status: String(STATUS_SUCCESS),
      timestamp: String(Date.now()),
      recvWindow: '10000',
    });
    // Binance signs the exact query string it receives, so the signature
    // must be appended after every other parameter is already fixed.
    const signature = createHmac('sha256', this.apiSecret).update(params.toString()).digest('hex');
    params.append('signature', signature);

    const url = `${this.baseUrl}/sapi/v1/capital/deposit/hisrec?${params.toString()}`;
    const response = await withTimeout(
      fetch(url, { headers: { 'X-MBX-APIKEY': this.apiKey } }),
      REQUEST_TIMEOUT_MS,
      'binance deposit history',
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ExchangeRequestError(
        this.provider,
        `deposit history returned ${response.status}: ${body.slice(0, 200)}`,
        response.status,
      );
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new ExchangeRequestError(this.provider, 'deposit history was not an array');
    }

    return (payload as BinanceDepositRecord[])
      .filter((row) => row.status === STATUS_SUCCESS && row.txId && row.coin && row.amount)
      .map((row) => ({
        txId: String(row.txId),
        asset: String(row.coin).toUpperCase(),
        // A deposit with no network is a same-exchange internal transfer;
        // label it so it can still match a method configured that way.
        network: String(row.network ?? 'INTERNAL').toUpperCase(),
        amount: String(row.amount),
        address: row.address ? String(row.address) : undefined,
        rawStatus: String(row.status),
        creditedAt: row.insertTime ? new Date(row.insertTime) : undefined,
      }));
  }
}
