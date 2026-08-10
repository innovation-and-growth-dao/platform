import { BadRequestException, Injectable } from '@nestjs/common';
import { PLATFORM_CONFIG_DEFAULTS, PLATFORM_CONFIG_META } from '@drep-dao/shared';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';

type Defaults = typeof PLATFORM_CONFIG_DEFAULTS;

@Injectable()
export class GovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** §6/§28 — current governance parameters: defaults overlaid with DB overrides. */
  async getParams() {
    const rows = await this.prisma.platformConfig.findMany();
    const overrides = new Map(rows.map((r) => [r.key, r.value]));
    return (Object.entries(PLATFORM_CONFIG_DEFAULTS) as [keyof Defaults, Defaults[keyof Defaults]][]).map(
      ([key, def]) => ({
        key,
        value: overrides.has(key) ? overrides.get(key) : def,
        default: def,
        type: typeof def,
        description: PLATFORM_CONFIG_META[key] ?? '',
      }),
    );
  }

  /** Board updates one parameter (type-checked against its default). */
  async updateParam(userId: string, key: string, value: unknown) {
    if (!(key in PLATFORM_CONFIG_DEFAULTS)) {
      throw new BadRequestException(`unknown governance parameter: ${key}`);
    }
    const def = (PLATFORM_CONFIG_DEFAULTS as Record<string, unknown>)[key];
    let coerced: number | string | boolean;
    if (typeof def === 'boolean') {
      coerced = value === true || value === 'true' || value === 1 || value === '1';
    } else if (typeof def === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new BadRequestException(`${key} must be a number`);
      coerced = n;
    } else {
      coerced = String(value);
      // §15 — anything else would silently read as the 1_PHASE default downstream.
      if (key === 'TX_SIGNING_PROCESS' && coerced !== '1_PHASE' && coerced !== '2_PHASE') {
        throw new BadRequestException('TX_SIGNING_PROCESS must be 1_PHASE or 2_PHASE');
      }
    }
    await this.prisma.platformConfig.upsert({
      where: { key },
      update: { value: coerced as Prisma.InputJsonValue, updatedBy: userId },
      create: { key, value: coerced as Prisma.InputJsonValue, updatedBy: userId },
    });
    return { key, value: coerced };
  }
}
