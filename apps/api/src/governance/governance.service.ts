import { BadRequestException, Injectable } from '@nestjs/common';
import { decryptSecret, encryptSecret } from '../common/secret-cipher';
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

  // ── §22 On-chain data source: an ordered fallback list + credentials, board-configurable. ──
  // The order is stored in platform_config (CARDANO_ONCHAIN_ORDER); the Blockfrost key and the
  // db-sync URL are secrets in platform_secret. All fall back to env vars when unset, so a fresh
  // deploy keeps working before anything is configured.
  static readonly ONCHAIN_SOURCES = ['koios', 'blockfrost', 'dbsync'] as const;

  /** Current source order + which credentials are configured (values masked — never returned raw). */
  async getOnchainSource() {
    const orderRow = await this.prisma.platformConfig.findUnique({ where: { key: 'CARDANO_ONCHAIN_ORDER' } });
    const bf = decryptSecret((await this.prisma.platformSecret.findUnique({ where: { key: 'BLOCKFROST_PROJECT_ID' } }))?.value)?.trim()
      || process.env.BLOCKFROST_PROJECT_ID?.trim() || '';
    const dbs = decryptSecret((await this.prisma.platformSecret.findUnique({ where: { key: 'DBSYNC_URL' } }))?.value)?.trim()
      || process.env.DBSYNC_URL?.trim() || '';
    const kt = decryptSecret((await this.prisma.platformSecret.findUnique({ where: { key: 'KOIOS_API_TOKEN' } }))?.value)?.trim()
      || process.env.KOIOS_API_TOKEN?.trim() || '';
    return {
      order: this.parseOrder(typeof orderRow?.value === 'string' ? orderRow.value : null),
      available: GovernanceService.ONCHAIN_SOURCES,
      network: process.env.CARDANO_NETWORK ?? 'Preprod',
      // Koios works keyless (free tier). An optional token authenticates it for higher rate limits.
      koios: { tokenConfigured: !!kt, hint: kt ? `${kt.slice(0, 6)}…${kt.slice(-4)}` : null },
      blockfrost: { configured: !!bf, hint: bf ? `${bf.slice(0, 8)}…${bf.slice(-4)}` : null },
      dbsync: { configured: !!dbs, hint: dbs ? this.maskUrl(dbs) : null },
    };
  }

  /** Board updates the order and/or the credentials. An empty string clears a credential. */
  async updateOnchainSource(
    userId: string,
    dto: { order?: string[]; koiosApiToken?: string; blockfrostProjectId?: string; dbsyncUrl?: string },
  ) {
    if (dto.order !== undefined) {
      const clean = dto.order.map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (clean.length === 0) throw new BadRequestException('the source order cannot be empty');
      for (const s of clean) {
        if (!(GovernanceService.ONCHAIN_SOURCES as readonly string[]).includes(s)) {
          throw new BadRequestException(`unknown on-chain source: ${s}`);
        }
      }
      if (new Set(clean).size !== clean.length) throw new BadRequestException('the source order has a duplicate');
      await this.prisma.platformConfig.upsert({
        where: { key: 'CARDANO_ONCHAIN_ORDER' },
        update: { value: clean.join(','), updatedBy: userId },
        create: { key: 'CARDANO_ONCHAIN_ORDER', value: clean.join(','), updatedBy: userId },
      });
    }
    if (dto.koiosApiToken !== undefined) await this.setSecret('KOIOS_API_TOKEN', dto.koiosApiToken, userId);
    if (dto.blockfrostProjectId !== undefined) await this.setSecret('BLOCKFROST_PROJECT_ID', dto.blockfrostProjectId, userId);
    if (dto.dbsyncUrl !== undefined) await this.setSecret('DBSYNC_URL', dto.dbsyncUrl, userId);
    return this.getOnchainSource();
  }

  private parseOrder(csv: string | null): string[] {
    const parsed = (csv ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => (GovernanceService.ONCHAIN_SOURCES as readonly string[]).includes(s));
    if (parsed.length) return [...new Set(parsed)];
    // No stored order → derive a sensible default from the legacy env var.
    const env = (process.env.CARDANO_ONCHAIN_SOURCE ?? '').trim().toLowerCase();
    return env === 'dbsync' ? ['dbsync', 'koios'] : ['koios'];
  }

  private maskUrl(url: string): string {
    return url.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1***$2');
  }

  private async setSecret(key: string, value: string, userId: string) {
    const v = value.trim();
    if (!v) {
      await this.prisma.platformSecret.deleteMany({ where: { key } });
      return;
    }
    const encV = encryptSecret(v);
    await this.prisma.platformSecret.upsert({
      where: { key },
      update: { value: encV, updatedBy: userId },
      create: { key, value: encV, updatedBy: userId },
    });
  }
}
