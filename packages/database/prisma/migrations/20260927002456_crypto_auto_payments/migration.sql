-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MANUAL', 'BINANCE', 'BYBIT');

-- CreateEnum
CREATE TYPE "CryptoWatchStatus" AS ENUM ('WAITING', 'MATCHED', 'EXPIRED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderEventType" ADD VALUE 'CRYPTO_WATCH_OPENED';
ALTER TYPE "OrderEventType" ADD VALUE 'CRYPTO_PAYMENT_DETECTED';
ALTER TYPE "OrderEventType" ADD VALUE 'CRYPTO_WATCH_EXPIRED';

-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN     "cryptoAsset" TEXT,
ADD COLUMN     "cryptoNetwork" TEXT,
ADD COLUMN     "depositAddress" TEXT,
ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "watchTtlMinutes" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "crypto_payment_watches" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "asset" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "expectedAmount" DECIMAL(24,8) NOT NULL,
    "status" "CryptoWatchStatus" NOT NULL DEFAULT 'WAITING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "claimKey" TEXT,

    CONSTRAINT "crypto_payment_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_deposits" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "txId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "address" TEXT,
    "rawStatus" TEXT,
    "creditedAt" TIMESTAMP(3),
    "watchId" TEXT,
    "orderId" TEXT,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crypto_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crypto_payment_watches_orderId_key" ON "crypto_payment_watches"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_payment_watches_claimKey_key" ON "crypto_payment_watches"("claimKey");

-- CreateIndex
CREATE INDEX "crypto_payment_watches_status_expiresAt_idx" ON "crypto_payment_watches"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "crypto_payment_watches_provider_status_idx" ON "crypto_payment_watches"("provider", "status");

-- CreateIndex
CREATE INDEX "crypto_deposits_watchId_idx" ON "crypto_deposits"("watchId");

-- CreateIndex
CREATE INDEX "crypto_deposits_seenAt_idx" ON "crypto_deposits"("seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_deposits_provider_txId_key" ON "crypto_deposits"("provider", "txId");

-- AddForeignKey
ALTER TABLE "crypto_payment_watches" ADD CONSTRAINT "crypto_payment_watches_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_payment_watches" ADD CONSTRAINT "crypto_payment_watches_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_deposits" ADD CONSTRAINT "crypto_deposits_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "crypto_payment_watches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
