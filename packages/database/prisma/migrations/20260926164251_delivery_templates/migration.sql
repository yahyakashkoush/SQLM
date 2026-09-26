-- AlterTable
ALTER TABLE "products" ADD COLUMN     "deliveryTemplateId" TEXT;

-- CreateTable
CREATE TABLE "delivery_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_templates_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_deliveryTemplateId_fkey" FOREIGN KEY ("deliveryTemplateId") REFERENCES "delivery_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Starter templates so fulfillment has sensible layouts out of the box.
INSERT INTO "delivery_templates" ("id", "name", "content", "updatedAt") VALUES
  (gen_random_uuid()::text, 'حساب (إيميل + باسورد)', E'الإيميل: \nالباسورد: ', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'بروفايل (إيميل + باسورد + بروفايل + PIN)', E'الإيميل: \nالباسورد: \nاسم البروفايل: \nPIN: ', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'كود / مفتاح تفعيل', E'الكود: ', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'تفعيل على إيميل العميل', E'تم التفعيل على الإيميل: \nتاريخ الانتهاء: ', CURRENT_TIMESTAMP);
