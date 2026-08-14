import { Controller, Get, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RoundsService } from '../rounds/rounds.service';
import { TreasuryService } from '../treasury/treasury.service';

/**
 * Public, unauthenticated snapshot for the logged-out landing page. Only aggregate,
 * non-sensitive numbers (all derivable from on-chain data or public directories) —
 * no per-member private fields. Cached briefly so an anonymous visitor can't drive
 * repeated treasury/chain lookups.
 */
@Controller('public')
export class PublicOverviewController {
  private readonly logger = new Logger(PublicOverviewController.name);
  private cache: { value: unknown; expiresAt: number } | null = null;
  private readonly TTL_MS = 30_000;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly rounds: RoundsService,
    private readonly treasury: TreasuryService,
  ) {}

  @Get('overview')
  async overview() {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    const value = await this.build();
    this.cache = { value, expiresAt: Date.now() + this.TTL_MS };
    return value;
  }

  private async build() {
    const network = this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod';
    const [votingDReps, experts, propGroups, internalGroups, boardSeats, activeRound, admissionRow] = await Promise.all([
      this.prisma.drep.count({ where: { status: 'ADMITTED' } }),
      this.prisma.expert.count({ where: { approvedByBoard: true } }),
      this.prisma.proposal.groupBy({ by: ['status'], where: { type: 'FUNDING' }, _count: { _all: true } }),
      this.prisma.proposal.groupBy({ by: ['status'], where: { type: 'INTERNAL' }, _count: { _all: true } }),
      this.prisma.boardSeat.count({ where: { removedAt: null } }),
      this.rounds.activeRound().catch(() => null),
      this.prisma.platformConfig.findUnique({ where: { key: 'DREP_OPEN_ADMISSION' } }),
    ]);

    const count = (s: string) => propGroups.find((g) => g.status === s)?._count._all ?? 0;
    const approved = count('APPROVED') + count('COMPLETE');
    const inReview = count('PENDING') + count('ACTIVE');
    const rejected = count('REJECTED') + count('FAILED');

    // §governance — internal (governance) proposals, for the DRep-DAO edition's tiles.
    const iCount = (s: string) => internalGroups.find((g) => g.status === s)?._count._all ?? 0;
    const internalActive = iCount('ACTIVE') + iCount('PENDING');
    const internalPassed = iCount('APPROVED') + iCount('COMPLETE');
    const internalTotal = internalGroups.reduce((sum, g) => sum + g._count._all, 0);

    // Treasury balance is on-chain (public), but best-effort — a chain hiccup must not 500 the landing.
    let treasuryBalanceAda: number | null = null;
    try {
      treasuryBalanceAda = (await this.treasury.overview()).treasury.balanceAda;
    } catch (e) {
      this.logger.warn(`public overview treasury balance: ${e instanceof Error ? e.message : e}`);
    }

    // DREP_OPEN_ADMISSION defaults ON when unset (matches the admission logic).
    const admissionOpen = admissionRow ? admissionRow.value === true : true;

    const r = activeRound as
      | { number: number; name: string; status: string; budgetAda: number; rewardsPoolAda: number; eligibleCount: number; proposalCount: number }
      | null;

    return {
      network,
      admissionOpen,
      treasuryBalanceAda,
      members: { votingDReps, experts },
      board: { seats: boardSeats, elected: boardSeats > 0 },
      proposals: { approved, inReview, rejected, total: approved + inReview + rejected },
      internalProposals: { active: internalActive, passed: internalPassed, total: internalTotal },
      activeRound: r
        ? {
            number: r.number,
            name: r.name,
            status: r.status,
            budgetAda: r.budgetAda,
            rewardsPoolAda: r.rewardsPoolAda,
            eligibleCount: r.eligibleCount,
            proposalCount: r.proposalCount,
          }
        : null,
    };
  }
}
