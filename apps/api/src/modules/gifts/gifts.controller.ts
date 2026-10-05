import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import { CurrentCustomer, type AuthenticatedCustomer } from '../rbac/decorators/current-customer.decorator';
import { GiftsService } from './gifts.service';
import { ReviewsService } from './reviews.service';
import { SubmitSocialRewardDto, CreateProductReviewDto } from './dto/gifts.dto';

@Controller('store/gifts')
export class GiftsController {
  constructor(
    private readonly gifts: GiftsService,
    private readonly reviews: ReviewsService,
  ) {}

  /** List all active gift products (instant free + social reward). */
  @Get()
  listGifts() {
    return this.gifts.listGiftProducts();
  }

  /** Claim an instant free gift (auth required). */
  @Post(':productId/claim')
  @UseGuards(JwtCustomerAuthGuard)
  claimGift(@Param('productId') productId: string, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.gifts.claimInstantGift(customer.id, productId);
  }

  /** Submit a social reward claim (auth required). */
  @Post('social-reward')
  @UseGuards(JwtCustomerAuthGuard)
  submitSocialReward(@Body() dto: SubmitSocialRewardDto, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.gifts.submitSocialReward(customer.id, dto);
  }

  /** List customer's own social reward submissions. */
  @Get('social-rewards/mine')
  @UseGuards(JwtCustomerAuthGuard)
  myRewards(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.gifts.listCustomerSocialRewards(customer.id);
  }

  /** List reviews for a product. */
  @Get(':productId/reviews')
  listReviews(
    @Param('productId') productId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reviews.listProductReviews(productId, Number(page) || 1, Number(pageSize) || 10);
  }

  /** Submit a review for a completed order. */
  @Post('reviews')
  @UseGuards(JwtCustomerAuthGuard)
  submitReview(@Body() dto: CreateProductReviewDto, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.reviews.createReview(customer.id, dto);
  }

  /** Mark a review as helpful. */
  @Post('reviews/:reviewId/helpful')
  @UseGuards(JwtCustomerAuthGuard)
  markHelpful(@Param('reviewId') reviewId: string) {
    return this.reviews.markHelpful(reviewId);
  }
}
