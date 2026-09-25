import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { encryptSecret } from '@sqlm/shared';

const prisma = new PrismaClient();

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@sqlm.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe123!';
const ENCRYPTION_KEY = process.env.INVENTORY_ENCRYPTION_KEY;

async function seedOwner() {
  const passwordHash = await argon2.hash(OWNER_PASSWORD);
  const owner = await prisma.staff.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      email: OWNER_EMAIL,
      passwordHash,
      name: 'Platform Owner',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
  console.warn(`[seed] owner staff account ready: ${owner.email}`);
  if (!process.env.SEED_OWNER_PASSWORD) {
    console.warn(`[seed]   dev-only default password: ${OWNER_PASSWORD} — change before any shared use.`);
  }
}

async function seedPaymentMethods() {
  const methods = [
    {
      name: 'Bank Transfer',
      description: 'Transfer to our bank account and upload your receipt.',
      accountNumber: 'IBAN-EXAMPLE-0000-0000-0000',
      instructions: 'Include your order number in the transfer reference.',
      currency: 'USD',
      displayOrder: 1,
    },
    {
      name: 'Vodafone Cash',
      description: 'Send to our Vodafone Cash wallet.',
      accountNumber: '01000000000',
      instructions: 'Send the exact order total, then upload the confirmation screenshot.',
      currency: 'EGP',
      displayOrder: 2,
    },
    {
      name: 'InstaPay',
      description: 'Pay instantly via InstaPay.',
      accountNumber: 'sqlm@instapay',
      instructions: 'Use the order number as the payment note.',
      currency: 'EGP',
      displayOrder: 3,
    },
  ];

  for (const method of methods) {
    const existing = await prisma.paymentMethod.findFirst({ where: { name: method.name } });
    if (existing) continue;
    await prisma.paymentMethod.create({ data: method });
  }
  console.warn(`[seed] payment methods ready (${methods.length})`);
}

async function seedPlatformSettings() {
  const settings: Array<{ key: string; value: unknown }> = [
    { key: 'store.name', value: 'SQLM Store' },
    { key: 'store.supportContact', value: '@sqlm_support' },
    { key: 'store.defaultCurrency', value: 'USD' },
  ];

  for (const setting of settings) {
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: { key: setting.key, value: setting.value as never },
    });
  }
  console.warn(`[seed] platform settings ready (${settings.length})`);
}

/**
 * Illustrative dev fixtures only — not hardcoded into any application logic.
 * Freely editable/deletable from the Admin Dashboard once it exists (Phase
 * 11); nothing in apps/api branches on these specific products.
 */
async function seedCatalog() {
  const category = await prisma.category.upsert({
    where: { slug: 'ai-subscriptions' },
    update: {},
    create: {
      slug: 'ai-subscriptions',
      name: 'AI Subscriptions',
      description: 'AI tools and assistant subscriptions.',
      displayOrder: 1,
    },
  });

  const automaticProduct = await prisma.product.upsert({
    where: { slug: 'example-ai-assistant-plus' },
    update: {},
    create: {
      slug: 'example-ai-assistant-plus',
      name: 'Example AI Assistant Plus (1 Month)',
      shortDescription: 'Full access, delivered instantly from stock.',
      description: 'Demo product showing the AUTOMATIC delivery + INDIVIDUAL inventory path.',
      categoryId: category.id,
      price: 19.99,
      currency: 'USD',
      duration: '1 month',
      warranty: '7 days replacement warranty',
      inventoryMode: 'INDIVIDUAL',
      deliveryType: 'AUTOMATIC',
      fulfillmentType: 'ACCOUNT',
      activationInstructions: 'Log in with the provided email and password.',
      status: 'ACTIVE',
      visibility: 'VISIBLE',
      featured: true,
      tags: ['ai', 'subscription'],
    },
  });

  if (ENCRYPTION_KEY) {
    const existingItems = await prisma.inventoryItem.count({
      where: { productId: automaticProduct.id },
    });
    if (existingItems === 0) {
      await prisma.inventoryItem.createMany({
        data: [
          { productId: automaticProduct.id, encryptedPayload: encryptSecret('demo1@example.com:Passw0rd!', ENCRYPTION_KEY) },
          { productId: automaticProduct.id, encryptedPayload: encryptSecret('demo2@example.com:Passw0rd!', ENCRYPTION_KEY) },
        ],
      });
      console.warn('[seed] seeded 2 encrypted inventory items for example-ai-assistant-plus');
    }
  } else {
    console.warn('[seed] INVENTORY_ENCRYPTION_KEY not set — skipping inventory item seed');
  }

  await prisma.product.upsert({
    where: { slug: 'example-productivity-suite' },
    update: {},
    create: {
      slug: 'example-productivity-suite',
      name: 'Example Productivity Suite (Lifetime)',
      shortDescription: 'Manually activated by our team after payment.',
      description: 'Demo product showing the MANUAL delivery + QUANTITY inventory path.',
      categoryId: category.id,
      price: 49.0,
      currency: 'USD',
      duration: 'Lifetime',
      warranty: '30 days support',
      stock: 25,
      inventoryMode: 'QUANTITY',
      deliveryType: 'MANUAL',
      fulfillmentType: 'SUBSCRIPTION',
      activationInstructions: 'A delivery agent will contact you within 24 hours to activate.',
      status: 'ACTIVE',
      visibility: 'VISIBLE',
      tags: ['productivity'],
    },
  });

  console.warn('[seed] catalog ready (1 category, 2 products)');
}

async function main() {
  await seedOwner();
  await seedPaymentMethods();
  await seedPlatformSettings();
  await seedCatalog();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
