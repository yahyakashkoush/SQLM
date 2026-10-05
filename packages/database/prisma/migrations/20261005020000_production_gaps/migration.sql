-- Production gaps: TOTP 2FA, cost price, customer notifications

-- TOTP 2FA fields on staff
ALTER TABLE "staff" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "staff" ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Cost price on products (for profit analytics)
ALTER TABLE "products" ADD COLUMN "costPrice" DECIMAL(12,2);

-- Customer notifications inbox
CREATE TABLE "customer_notifications" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "metadata" JSONB,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_notifications_customerId_isRead_idx"
  ON "customer_notifications"("customerId", "isRead");

ALTER TABLE "customer_notifications"
  ADD CONSTRAINT "customer_notifications_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
