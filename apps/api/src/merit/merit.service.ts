import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MERIT_DELTAS, type MeritReason, clampMerit, PLATFORM_CONFIG_DEFAULTS } from '@drep-dao/shared';

/**
 * §13 — the single writer of the merit ledger. Every gain/loss is one ledger row;
 * the current balance is the clamped sum (computed in the readers). All writes are
 * idempotent on (drepId, reasonCode, referenceId) so the daily sweep and the action
 * hooks can run repeatedly without ever double-counting a point.
 */
@Injectable()
export class MeritService {
  constructor(private readonly prisma: PrismaService) {}

  private enabledCache: { v: boolean; exp: number } | null = null;

  /** §13 — is the merit-point system on? Cached 60s so the hot award path isn't a DB hit. */
  async meritEnabled(): Promise<boolean> {
    if (this.enabledCache && this.enabledCache.exp > Date.now()) return this.enabledCache.v;
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'MERIT_ENABLED' } });
    const v = row ? row.value === true : (PLATFORM_CONFIG_DEFAULTS.MERIT_ENABLED as boolean);
    this.enabledCache = { v, exp: Date.now() + 60_000 };
    return v;
  }

  /** Record one delta for a DRep. Returns false if it was already recorded (or merit is off). */
  async award(drepId: string, reason: MeritReason, referenceId?: string | null): Promise<boolean> {
    if (!(await this.meritEnabled())) return false; // §13 off → merit is neither earned nor lost
    const ref = referenceId ?? null;
    const existing = await this.prisma.meritLedger.findFirst({
      where: { drepId, reasonCode: reason, referenceId: ref },
      select: { id: true },
    });
    if (existing) return false;
    await this.prisma.meritLedger.create({
      data: { drepId, delta: MERIT_DELTAS[reason], reasonCode: reason, referenceId: ref },
    });
    return true;
  }

  /** Best-effort — merit must never block the underlying vote/payment. */
  async tryAward(drepId: string, reason: MeritReason, referenceId?: string | null): Promise<void> {
    try {
      await this.award(drepId, reason, referenceId);
    } catch {
      /* merit is non-critical */
    }
  }

  async awardMany(drepIds: string[], reason: MeritReason, referenceId?: string | null): Promise<void> {
    for (const id of new Set(drepIds.filter(Boolean))) await this.tryAward(id, reason, referenceId);
  }

  /** Active board seats → their Drep ids (matched by on-chain DRep id). */
  async boardDrepIds(): Promise<string[]> {
    const seats = await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepId: true } });
    if (!seats.length) return [];
    const dreps = await this.prisma.drep.findMany({
      where: { drepIdOnchain: { in: seats.map((s) => s.drepId) } },
      select: { id: true },
    });
    return dreps.map((d) => d.id);
  }

  /** Collective board reward/penalty — every active seat gets the delta (§13.2/13.3). */
  async awardBoard(reason: MeritReason, referenceId?: string | null): Promise<void> {
    await this.awardMany(await this.boardDrepIds(), reason, referenceId);
  }

  // ── reads + avoid periods (the §13.4 "vacancy signal") ────────────────────

  /** Current merit + recent ledger for a user's DRep. */
  async myMerit(userId: string) {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } });
    if (!drep) return { points: 0, ledger: [] as { delta: number; reason: string; at: Date }[] };
    const agg = await this.prisma.meritLedger.aggregate({ where: { drepId: drep.id }, _sum: { delta: true } });
    const rows = await this.prisma.meritLedger.findMany({
      where: { drepId: drep.id },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });
    return {
      points: clampMerit(agg._sum.delta ? Number(agg._sum.delta) : 0),
      ledger: rows.map((l) => ({ delta: Number(l.delta), reason: l.reasonCode, at: l.occurredAt })),
    };
  }

  /** §13.4 — is the DRep inside an avoid period at `at` (excused from assignment/penalty)? */
  async isInAvoidPeriod(drepId: string, at: Date = new Date()): Promise<boolean> {
    const a = await this.prisma.drepAvoidPeriod.findFirst({
      where: { drepId, startsAt: { lte: at }, endsAt: { gte: at } },
      select: { id: true },
    });
    return !!a;
  }

  private async requireDrep(userId: string) {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } });
    if (!drep) throw new ForbiddenException('DReps only');
    return drep;
  }

  async listAvoidPeriods(userId: string) {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } });
    if (!drep) return [];
    return this.prisma.drepAvoidPeriod.findMany({ where: { drepId: drep.id }, orderBy: { startsAt: 'desc' } });
  }

  async setAvoidPeriod(userId: string, startsAt: string, endsAt: string, reason?: string) {
    const drep = await this.requireDrep(userId);
    const s = new Date(startsAt);
    const e = new Date(endsAt);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) {
      throw new BadRequestException('end must be after start');
    }
    // §13.4 — yearly cap (AVOID_PERIOD_MAX_DAYS_PER_YEAR): sum of this DRep's avoid days that
    // fall into the calendar year(s) the new period touches, plus the new period, must stay
    // within the configured maximum.
    const cfg = await this.prisma.platformConfig.findUnique({ where: { key: 'AVOID_PERIOD_MAX_DAYS_PER_YEAR' } });
    const maxDays = typeof cfg?.value === 'number' ? cfg.value : (PLATFORM_CONFIG_DEFAULTS as Record<string, unknown>)['AVOID_PERIOD_MAX_DAYS_PER_YEAR'] as number;
    const DAY = 86_400_000;
    const overlapDays = (aS: Date, aE: Date, bS: Date, bE: Date) =>
      Math.max(0, (Math.min(aE.getTime(), bE.getTime()) - Math.max(aS.getTime(), bS.getTime())) / DAY);
    const existing = await this.prisma.drepAvoidPeriod.findMany({ where: { drepId: drep.id } });
    for (let year = s.getUTCFullYear(); year <= e.getUTCFullYear(); year++) {
      const yS = new Date(Date.UTC(year, 0, 1));
      const yE = new Date(Date.UTC(year + 1, 0, 1));
      const used = existing.reduce((sum, pr) => sum + overlapDays(pr.startsAt, pr.endsAt, yS, yE), 0);
      const wanted = overlapDays(s, e, yS, yE);
      if (used + wanted > maxDays) {
        throw new BadRequestException(
          `avoid-period limit exceeded for ${year}: ${Math.ceil(used + wanted)} days requested, maximum ${maxDays} per year`,
        );
      }
    }
    return this.prisma.drepAvoidPeriod.create({ data: { drepId: drep.id, startsAt: s, endsAt: e, reason: reason ?? null } });
  }

  async removeAvoidPeriod(userId: string, id: string) {
    const drep = await this.requireDrep(userId);
    await this.prisma.drepAvoidPeriod.deleteMany({ where: { id, drepId: drep.id } });
    return { ok: true };
  }
}
