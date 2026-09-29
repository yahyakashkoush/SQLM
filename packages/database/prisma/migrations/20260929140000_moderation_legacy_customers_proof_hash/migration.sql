-- AlterEnum
ALTER TYPE "MemberDiscountKind" ADD VALUE 'LEGACY';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "banReason" TEXT,
ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "payment_proofs" ADD COLUMN     "contentHash" TEXT;

-- CreateTable
CREATE TABLE "legacy_customers" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "discountPercent" DECIMAL(5,2),
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legacy_customers_phone_key" ON "legacy_customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_customers_claimedById_key" ON "legacy_customers"("claimedById");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "payment_proofs_contentHash_idx" ON "payment_proofs"("contentHash");

-- AddForeignKey
ALTER TABLE "legacy_customers" ADD CONSTRAINT "legacy_customers_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

