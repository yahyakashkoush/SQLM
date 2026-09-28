-- Customer tiers, staff Telegram linking and payment-currency snapshots.
-- Purely additive: new nullable/defaulted columns, one enum, two indexes,
-- and a backfill that only fills columns this migration creates.

-- CreateEnum
CREATE TYPE "MemberDiscountKind" AS ENUM ('VERIFIED', 'WELCOME');

-- AlterTable
ALTER TABLE "staff"
  ADD COLUMN "telegramId" BIGINT,
  ADD COLUMN "telegramNotify" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "customers"
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "welcomeGiftOrderId" TEXT;

-- AlterTable
ALTER TABLE "orders"
  ADD COLUMN "memberDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "memberDiscountKind" "MemberDiscountKind",
  ADD COLUMN "payCurrency" TEXT,
  ADD COLUMN "payAmount" DECIMAL(14,2),
  ADD COLUMN "exchangeRate" DECIMAL(14,6);

-- CreateIndex
CREATE UNIQUE INDEX "staff_telegramId_key" ON "staff"("telegramId");

-- CreateIndex
CREATE INDEX "customers_verifiedAt_idx" ON "customers"("verifiedAt");

-- Backfill: anyone who has already paid for an order is verified as of
-- their first payment, exactly as if the rule had existed then.
UPDATE "customers" c
   SET "verifiedAt" = p.first_paid
  FROM (
        SELECT "customerId", MIN("paidAt") AS first_paid
          FROM "orders"
         WHERE "paidAt" IS NOT NULL
         GROUP BY "customerId"
       ) p
 WHERE c."id" = p."customerId";
