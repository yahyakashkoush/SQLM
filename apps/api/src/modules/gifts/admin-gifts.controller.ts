import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';
import { GiftsService } from './gifts.service';
import { ReviewsService } from './reviews.service';
import { ReviewSocialRewardDto } from './dto/gifts.dto';

@Controller('admin/gifts')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminGiftsController {
  constructor(
    private readonly gifts: GiftsService,
    private readonly reviews: ReviewsService,
  ) {}

  /** List pending social reward claims. */
  @Get('social-rewards')
  @Permissions('orders.read')
  listPending(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.gifts.listSocialRewardsPending(Number(page) || 1, Number(pageSize) || 20);
  }

  /** Approve a social reward claim — creates gift order and triggers delivery. */
  @Post('social-rewards/:id/approve')
  @Permissions('orders.write')
  approve(@Param('id') id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.gifts.approveSocialReward(id, staff.id);
  }

  /** Reject a social reward claim. */
  @Post('social-rewards/:id/reject')
  @Permissions('orders.write')
  reject(
    @Param('id') id: string,
    @Body() dto: ReviewSocialRewardDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.gifts.rejectSocialReward(id, staff.id, dto.rejectionReason);
  }

  /** List all reviews (admin view for moderation). */
  @Get('reviews')
  @Permissions('orders.read')
  listReviews(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reviews.listAdmin(Number(page) || 1, Number(pageSize) || 20);
  }

  /** Delete a review. */
  @Delete('reviews/:id')
  @Permissions('orders.write')
  deleteReview(@Param('id') id: string) {
    return this.reviews.deleteReview(id);
  }
}
