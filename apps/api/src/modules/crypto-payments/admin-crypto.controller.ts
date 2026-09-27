import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CryptoWatchService } from './crypto-watch.service';
import { DepositPollerService } from './deposit-poller.service';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';

type WatchStatus = 'WAITING' | 'MATCHED' | 'EXPIRED' | 'CANCELLED';

@Controller('admin/crypto-payments')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminCryptoController {
  constructor(
    private readonly watches: CryptoWatchService,
    private readonly poller: DepositPollerService,
  ) {}

  @Get('providers')
  @Permissions('payments.methods.read')
  providers() {
    return this.watches.providerStatus();
  }

  @Get('watches')
  @Permissions('payments.proofs.read')
  listWatches(@Query('status') status?: WatchStatus) {
    return this.watches.listWatchesAdmin(status);
  }

  @Get('deposits')
  @Permissions('payments.proofs.read')
  listDeposits(@Query('unmatched') unmatched?: string) {
    return this.watches.listDepositsAdmin(unmatched === 'true');
  }

  /** Sweep now instead of waiting for the next tick — the button support
   *  reaches for when a customer says they have already sent it. */
  @Post('poll')
  @Permissions('payments.proofs.review')
  poll() {
    return this.poller.pollOnce();
  }
}
