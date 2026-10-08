-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('TOPUP', 'PURCHASE', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WalletTopUpStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "walletBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "walletPaid" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "orderId" TEXT,
    "topUpId" TEXT,
    "staffId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_top_ups" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "paymentMethodId" TEXT,
    "payCurrency" TEXT,
    "payAmount" DECIMAL(14,2),
    "exchangeRate" DECIMAL(14,6),
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "senderReference" TEXT,
    "status" "WalletTopUpStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_top_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_topUpId_key" ON "wallet_entries"("topUpId");

-- CreateIndex
CREATE INDEX "wallet_entries_customerId_createdAt_idx" ON "wallet_entries"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_entries_orderId_idx" ON "wallet_entries"("orderId");

-- CreateIndex
CREATE INDEX "wallet_top_ups_status_createdAt_idx" ON "wallet_top_ups"("status", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_top_ups_customerId_createdAt_idx" ON "wallet_top_ups"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_top_ups_contentHash_idx" ON "wallet_top_ups"("contentHash");

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_topUpId_fkey" FOREIGN KEY ("topUpId") REFERENCES "wallet_top_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A balance can never go negative, whatever the code path.
ALTER TABLE "customers" ADD CONSTRAINT "customers_walletBalance_nonnegative" CHECK ("walletBalance" >= 0);

-- Cost snapshot per order line, for the profit report.
ALTER TABLE "order_items" ADD COLUMN "unitCost" DECIMAL(12,2);
-- Orders placed before the snapshot existed take today's cost price.
UPDATE "order_items" oi SET "unitCost" = p."costPrice" FROM "products" p WHERE oi."productId" = p."id" AND oi."unitCost" IS NULL;
