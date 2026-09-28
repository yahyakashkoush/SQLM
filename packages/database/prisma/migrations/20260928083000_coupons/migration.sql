-- Additive. Existing orders get discountTotal 0 and NULL coupon columns,
-- which is exactly "no coupon was used", so nothing has to be backfilled.

CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FIXED');

CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "minSubtotal" DECIMAL(12,2),
    "maxDiscount" DECIMAL(12,2),
    "maxRedemptions" INTEGER,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "timesRedeemed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- Codes are stored upper-cased, so this unique is also what stops
-- "welcome10" and "WELCOME10" existing as two different coupons.
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");
CREATE INDEX "coupons_active_endsAt_idx" ON "coupons"("active", "endsAt");

CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "customerSeq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- The per-customer cap, enforced by the database rather than by a
-- count-then-insert: two concurrent checkouts both claiming use #1 leave
-- exactly one winner.
CREATE UNIQUE INDEX "coupon_redemptions_couponId_customerId_customerSeq_key"
  ON "coupon_redemptions"("couponId", "customerId", "customerSeq");

-- One redemption per order: this is what makes a retried checkout unable
-- to spend the same code twice.
CREATE UNIQUE INDEX "coupon_redemptions_orderId_key" ON "coupon_redemptions"("orderId");
CREATE INDEX "coupon_redemptions_couponId_customerId_idx"
  ON "coupon_redemptions"("couponId", "customerId");

ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_couponId_fkey"
  FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD COLUMN "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "couponId" TEXT;
ALTER TABLE "orders" ADD COLUMN "couponCode" TEXT;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_couponId_fkey"
  FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
