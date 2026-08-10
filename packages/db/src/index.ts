import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Single PrismaClient per process. In dev, hot-reload can otherwise spawn many
 * clients and exhaust Postgres connections, so we cache on globalThis.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
