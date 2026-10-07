import { PrismaClient } from '@prisma/client';

/**
 * Suites open dozens of unpaid orders for one customer within seconds; the
 * production limit (a few per hour) would refuse them. Raised here, once,
 * so the suites exercise checkout itself — the limit has its own test.
 */
export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.platformSetting.upsert({
      where: { key: 'security.maxUnpaidOrdersPerHour' },
      create: { key: 'security.maxUnpaidOrdersPerHour', value: 100000 },
      update: { value: 100000 },
    });
  } finally {
    await prisma.$disconnect();
  }
}
