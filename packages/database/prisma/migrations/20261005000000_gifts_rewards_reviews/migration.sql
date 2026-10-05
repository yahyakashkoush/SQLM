-- Add gift & reward fields to products
ALTER TABLE "products" ADD COLUMN "giftType" TEXT,
ADD COLUMN "maxGiftClaims" INTEGER,
ADD COLUMN "giftClaimsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "ratingScore" DECIMAL(3,2) DEFAULT 0,
ADD COLUMN "reviewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "salesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "badge" TEXT; -- "NEW", "BESTSELLER", "LIMITED", "EXCLUSIVE"

-- Create product reviews table (testimonials, ratings)
CREATE TABLE "product_reviews" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL, -- 1-5 stars
  "title" TEXT,
  "comment" TEXT,
  "attachmentUrls" TEXT[], -- image/video URLs
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "helpful" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT,
  CONSTRAINT "product_reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE CASCADE,
  CONSTRAINT "product_reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE,
  UNIQUE ("orderId", "productId")
);

CREATE INDEX "product_reviews_productId_idx" ON "product_reviews"("productId");
CREATE INDEX "product_reviews_customerId_idx" ON "product_reviews"("customerId");
CREATE INDEX "product_reviews_rating_idx" ON "product_reviews"("rating");
CREATE INDEX "product_reviews_verified_idx" ON "product_reviews"("verified");

-- Create social reward claims table (Facebook comment/rating rewards)
CREATE TABLE "social_reward_claims" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "claimType" TEXT NOT NULL, -- "FACEBOOK_COMMENT", "FACEBOOK_RATING"
  "facebookPostUrl" TEXT,
  "facebookProfileUrl" TEXT,
  "proofScreenshots" TEXT[],
  "status" TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "orderId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_reward_claims_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE,
  CONSTRAINT "social_reward_claims_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE CASCADE,
  CONSTRAINT "social_reward_claims_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE SET NULL,
  CONSTRAINT "social_reward_claims_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "staff" ("id") ON DELETE SET NULL
);

CREATE INDEX "social_reward_claims_productId_idx" ON "social_reward_claims"("productId");
CREATE INDEX "social_reward_claims_customerId_idx" ON "social_reward_claims"("customerId");
CREATE INDEX "social_reward_claims_status_idx" ON "social_reward_claims"("status");

-- Create product variants table (size, color, tier options)
CREATE TABLE "product_variants" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "priceModifier" DECIMAL(12,2) DEFAULT 0,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE,
  UNIQUE ("productId", "sku")
);

CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");
