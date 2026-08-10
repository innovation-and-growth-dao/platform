import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

type ComponentStatus = 'up' | 'down';

interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  time: string;
  components: {
    database: ComponentStatus;
    redis: ComponentStatus;
  };
}

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Liveness/readiness. Always 200 with per-component status so the API is
  // observable even before Postgres/Redis are running (§26 ops).
  @Get(['healthz', 'internal/healthz'])
  async health(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const components = { database, redis };
    const allUp = Object.values(components).every((s) => s === 'up');
    return {
      status: allUp ? 'ok' : 'degraded',
      service: 'drep-dao-api',
      time: new Date().toISOString(),
      components,
    };
  }

  private async checkDb(): Promise<ComponentStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<ComponentStatus> {
    return (await this.redis.ping()) ? 'up' : 'down';
  }
}
