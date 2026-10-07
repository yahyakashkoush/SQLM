-- Customer contact, wholesale and suspension fields
ALTER TABLE "customers" ADD COLUMN "fullName" TEXT;
ALTER TABLE "customers" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "customers" ADD COLUMN "wholesaleAt" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "suspendedUntil" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "suspendReason" TEXT;

-- Payment proof sender reference
ALTER TABLE "payment_proofs" ADD COLUMN "senderReference" TEXT;

-- Bundles
CREATE TABLE "product_bundles" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "wholesaleOnly" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_bundles_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_bundles_productId_active_idx" ON "product_bundles"("productId", "active");
ALTER TABLE "product_bundles" ADD CONSTRAINT "product_bundles_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD COLUMN "lineTotal" DECIMAL(12,2);
ALTER TABLE "order_items" ADD COLUMN "bundleId" TEXT;
ALTER TABLE "order_items" ADD COLUMN "bundleLabel" TEXT;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "product_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Strikes
CREATE TABLE "customer_strikes" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "suspendedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_strikes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_strikes_customerId_createdAt_idx" ON "customer_strikes"("customerId", "createdAt");
ALTER TABLE "customer_strikes" ADD CONSTRAINT "customer_strikes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Appeals
CREATE TYPE "AppealStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TABLE "customer_appeals" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'PENDING',
    "response" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_appeals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_appeals_status_createdAt_idx" ON "customer_appeals"("status", "createdAt");
CREATE INDEX "customer_appeals_customerId_idx" ON "customer_appeals"("customerId");
ALTER TABLE "customer_appeals" ADD CONSTRAINT "customer_appeals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_appeals" ADD CONSTRAINT "customer_appeals_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Wholesale
CREATE TYPE "WholesaleStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE "wholesale_applications" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "monthlyVolume" TEXT,
    "notes" TEXT,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "status" "WholesaleStatus" NOT NULL DEFAULT 'PENDING',
    "staffNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wholesale_applications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "wholesale_applications_status_createdAt_idx" ON "wholesale_applications"("status", "createdAt");
CREATE INDEX "wholesale_applications_customerId_idx" ON "wholesale_applications"("customerId");
ALTER TABLE "wholesale_applications" ADD CONSTRAINT "wholesale_applications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wholesale_applications" ADD CONSTRAINT "wholesale_applications_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
