import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
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

  // SEC-08 — readiness (separate from liveness): 503 when a required dependency is down, so a
  // broken instance can be pulled from rotation instead of silently serving errors.
  @Get(['readyz', 'internal/readyz'])
  async ready(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const components = { database, redis };
    const allUp = Object.values(components).every((s) => s === 'up');
    const report: HealthReport = { status: allUp ? 'ok' : 'degraded', service: 'drep-dao-api', time: new Date().toISOString(), components };
    if (!allUp) throw new ServiceUnavailableException(report);
    return report;
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
