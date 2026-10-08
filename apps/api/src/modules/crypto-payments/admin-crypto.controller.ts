import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CryptoWatchService } from './crypto-watch.service';
import { DepositPollerService } from './deposit-poller.service';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff } from '../rbac/decorators/current-staff.decorator';
import type { AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';

type WatchStatus = 'WAITING' | 'MATCHED' | 'EXPIRED' | 'CANCELLED';

export class MatchDepositDto {
  @IsUUID()
  orderId!: string;
}

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
    return this.watches.listDepositsAdmin(unmatched === 'true', (deposit) =>
      this.poller.findNearMisses(deposit),
    );
  }

  /**
   * Credits a deposit against an order by hand.
   *
   * The resolution for money the matcher cannot claim itself: a wrong
   * amount, or a transfer that landed after the window closed. Same
   * permission as approving a payment proof, because it is the same
   * decision — this order is paid.
   */
  @Post('deposits/:id/match')
  @Permissions('payments.proofs.review')
  async matchDeposit(
    @Param('id') id: string,
    @Body() dto: MatchDepositDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    await this.poller.matchManually(id, dto.orderId, staff.id);
    return { matched: true };
  }

  /** Sweep now instead of waiting for the next tick — the button support
   *  reaches for when a customer says they have already sent it. */
  @Post('poll')
  @Permissions('payments.proofs.review')
  poll() {
    return this.poller.pollOnce();
  }
}
