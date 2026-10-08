import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { ExchangeClient, ExchangeDeposit, ExchangeRequestError } from './exchange-client';
import { withTimeout } from '../../../common/utils/with-timeout';

/** Bybit deposit `status`: 3 is "success" (1 pending, 2 processing, 4 failed). */
const STATUS_SUCCESS = 3;
const RECV_WINDOW = '10000';
const REQUEST_TIMEOUT_MS = 15_000;

interface BybitDepositRow {
  coin?: string;
  chain?: string;
  amount?: string;
  txID?: string;
  status?: number;
  toAddress?: string;
  successAt?: string;
}

interface BybitEnvelope {
  retCode?: number;
  retMsg?: string;
  result?: { rows?: BybitDepositRow[] };
}

/**
 * Reads deposit records from Bybit's V5 API.
 *
 * Needs only a read-scoped key. V5 signs `timestamp + apiKey + recvWindow +
 * queryString` rather than the query string alone, and carries the result
 * in headers, so it can't share Binance's signing path.
 */
@Injectable()
export class BybitClient implements ExchangeClient {
  readonly provider = 'BYBIT' as const;
  private readonly logger = new Logger(BybitClient.name);
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('BYBIT_API_KEY');
    this.apiSecret = config.get<string>('BYBIT_API_SECRET');
    this.baseUrl = config.get<string>('BYBIT_API_BASE_URL') ?? 'https://api.bybit.com';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  async listDeposits(since: Date): Promise<ExchangeDeposit[]> {
    if (!this.apiKey || !this.apiSecret) return [];

    const query = new URLSearchParams({
      startTime: String(since.getTime()),
      endTime: String(Date.now()),
      limit: '50',
    }).toString();

    const timestamp = String(Date.now());
    const signature = createHmac('sha256', this.apiSecret)
      .update(`${timestamp}${this.apiKey}${RECV_WINDOW}${query}`)
      .digest('hex');

    const response = await withTimeout(
      fetch(`${this.baseUrl}/v5/asset/deposit/query-record?${query}`, {
        headers: {
          'X-BAPI-API-KEY': this.apiKey,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': RECV_WINDOW,
          'X-BAPI-SIGN': signature,
        },
      }),
      REQUEST_TIMEOUT_MS,
      'bybit deposit history',
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ExchangeRequestError(
        this.provider,
        `deposit history returned ${response.status}: ${body.slice(0, 200)}`,
        response.status,
      );
    }

    // Bybit answers 200 with a non-zero retCode for auth and parameter
    // errors, so HTTP status alone doesn't tell us the call succeeded.
    const payload = (await response.json()) as BybitEnvelope;
    if (payload.retCode !== 0) {
      throw new ExchangeRequestError(
        this.provider,
        `deposit history retCode ${payload.retCode}: ${payload.retMsg ?? 'unknown error'}`,
      );
    }

    return (payload.result?.rows ?? [])
      .filter((row) => row.status === STATUS_SUCCESS && row.txID && row.coin && row.amount)
      .map((row) => ({
        txId: String(row.txID),
        asset: String(row.coin).toUpperCase(),
        network: String(row.chain ?? 'INTERNAL').toUpperCase(),
        amount: String(row.amount),
        address: row.toAddress ? String(row.toAddress) : undefined,
        rawStatus: String(row.status),
        creditedAt: row.successAt ? new Date(Number(row.successAt)) : undefined,
      }));
  }
}
