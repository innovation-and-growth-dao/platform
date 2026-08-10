/**
 * Seed idempotent baseline data:
 *  - platform_config defaults (§20)
 *  - default subcategories (§5.3)
 * Run: pnpm db:seed
 */
import { PrismaClient } from '@prisma/client';
import { PLATFORM_CONFIG_DEFAULTS, DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';

const prisma = new PrismaClient();

async function main() {
  // §20 — platform configuration parameters
  for (const [key, value] of Object.entries(PLATFORM_CONFIG_DEFAULTS)) {
    await prisma.platformConfig.upsert({
      where: { key },
      update: {}, // do not clobber board-edited values on re-seed
      create: { key, value: value as never },
    });
  }
  console.log(`Seeded ${Object.keys(PLATFORM_CONFIG_DEFAULTS).length} platform_config keys`);

  // §5.3 — default cross-cutting subcategories
  for (let i = 0; i < DEFAULT_SUBCATEGORIES.length; i++) {
    const sc = DEFAULT_SUBCATEGORIES[i]!;
    await prisma.subcategory.upsert({
      where: { id: sc.id },
      update: { label: sc.label, sortIdx: i },
      create: { id: sc.id, label: sc.label, sortIdx: i },
    });
  }
  console.log(`Seeded ${DEFAULT_SUBCATEGORIES.length} subcategories`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
