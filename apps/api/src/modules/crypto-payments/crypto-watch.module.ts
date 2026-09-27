import { Global, Module } from '@nestjs/common';
import { BinanceClient } from './exchange/binance.client';
import { BybitClient } from './exchange/bybit.client';
import { ExchangeRegistry } from './exchange/exchange-registry.service';
import { CryptoWatchService } from './crypto-watch.service';

/**
 * Watch bookkeeping without the settlement side, split out the same way
 * DeliveryQueueModule is: OrdersService opens a watch at checkout, and the
 * poller that settles them imports OrdersModule — so keeping the two in
 * one module would close a cycle. Nothing here depends on orders.
 */
@Global()
@Module({
  providers: [BinanceClient, BybitClient, ExchangeRegistry, CryptoWatchService],
  exports: [CryptoWatchService, ExchangeRegistry],
})
export class CryptoWatchModule {}
