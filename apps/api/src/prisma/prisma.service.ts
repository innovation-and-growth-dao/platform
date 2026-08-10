import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@drep-dao/db';

/**
 * PrismaClient wired through Nest DI. We do NOT $connect in onModuleInit so the
 * API boots even when Postgres is down (Prisma connects lazily on first query);
 * the health check surfaces DB reachability instead.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      datasourceUrl: config.get<string>('DATABASE_URL'),
      log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
