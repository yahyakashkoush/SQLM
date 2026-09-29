-- Purely additive: new nullable columns and one defaulted counter, so
-- existing deposits and watches keep working untouched.

-- A stranded deposit is alerted on exactly once. NULL means "not yet told".
ALTER TABLE "crypto_deposits" ADD COLUMN "alertedAt" TIMESTAMP(3);

-- Who credited a deposit whose amount matched no watch.
ALTER TABLE "crypto_deposits" ADD COLUMN "matchedByStaffId" TEXT;

ALTER TABLE "crypto_deposits"
  ADD CONSTRAINT "crypto_deposits_matchedByStaffId_fkey"
  FOREIGN KEY ("matchedByStaffId") REFERENCES "staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The sweep's alert scan reads exactly this pair.
CREATE INDEX "crypto_deposits_creditedAt_alertedAt_idx"
  ON "crypto_deposits"("creditedAt", "alertedAt");

-- Bounded deadline extensions, so a page left open cannot hold an amount
-- out of the pool forever.
ALTER TABLE "crypto_payment_watches"
  ADD COLUMN "extensionsUsed" INTEGER NOT NULL DEFAULT 0;
