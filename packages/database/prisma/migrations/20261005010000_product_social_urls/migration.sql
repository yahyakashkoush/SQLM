-- AddColumn: socialPostUrl and socialPageUrl on products (for SOCIAL_REWARD gifts)
ALTER TABLE "products" ADD COLUMN "socialPostUrl" TEXT;
ALTER TABLE "products" ADD COLUMN "socialPageUrl" TEXT;
