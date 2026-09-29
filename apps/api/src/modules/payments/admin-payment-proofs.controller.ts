import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentProofsService } from './payment-proofs.service';
import { RejectPaymentProofDto, ProofInternalNoteDto } from './dto/review-payment-proof.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';

@Controller('admin/payment-proofs')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminPaymentProofsController {
  constructor(private readonly paymentProofs: PaymentProofsService) {}

  @Get()
  @Permissions('payments.proofs.read')
  listPending() {
    return this.paymentProofs.listPendingAdmin();
  }

  @Get(':id')
  @Permissions('payments.proofs.read')
  findById(@Param('id') id: string) {
    return this.paymentProofs.findByIdAdmin(id);
  }

  @Get(':id/view-url')
  @Permissions('payments.proofs.read')
  getViewUrl(@Param('id') id: string) {
    return this.paymentProofs.getViewUrl(id);
  }

  @Post(':id/approve')
  @Permissions('payments.proofs.review')
  approve(@Param('id') id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.paymentProofs.approve(id, staff.id);
  }

  @Post(':id/reject')
  @Permissions('payments.proofs.review')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectPaymentProofDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.paymentProofs.reject(id, staff.id, dto.reason, dto.cancelOrder ?? false);
  }

  @Post(':id/note')
  @Permissions('payments.proofs.review')
  addNote(@Param('id') id: string, @Body() dto: ProofInternalNoteDto) {
    return this.paymentProofs.addInternalNote(id, dto.note);
  }
}
