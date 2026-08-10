import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { TreasuryBucketsService } from './treasury-buckets.service';

/**
 * §16.3 — pledge return. After a milestone payout confirms on-chain:
 *   - PER_MILESTONE: return the pledge share proportional to that milestone's amount.
 *   - LAST_MILESTONE: return 100% once EVERY milestone is paid.
 * Each return is a PLEDGE_RETURN multisig action (board signs, same 3-of-5 ceremony), sourced
 * from the Pledge bucket, sent back to the address the pledge came from.
 */
@Injectable()
export class PledgeReturnService {
  private readonly logger = new Logger(PledgeReturnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
    private readonly buckets: TreasuryBucketsService,
  ) {}

  /** Idempotent — called after each PROJECT_FUNDING confirmation; safe to re-run. */
  async maybePrepareReturn(proposalId: string, paidMilestoneId: string) {
    const p = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true, title: true, publicId: true,
        pledgeAmountAda: true, pledgeReturnMethod: true, pledgeTxHash: true, pledgeConfirmedAt: true,
        milestones: { select: { id: true, idx: true, amountAda: true, paidAt: true } },
      },
    });
    if (!p?.pledgeAmountAda || p.pledgeAmountAda <= 0n || !p.pledgeConfirmedAt || !p.pledgeTxHash) return null;

    const method = p.pledgeReturnMethod ?? 'LAST_MILESTONE';
    if (method === 'LAST_MILESTONE') {
      if (!p.milestones.every((m) => m.paidAt)) return null; // not done yet
      return this.createReturn(p, null, p.pledgeAmountAda, 'full pledge — all milestones complete');
    }
    // PER_MILESTONE — this milestone's proportional share (the LAST share takes the rounding
    // remainder so the total returned equals the pledge exactly).
    const m = p.milestones.find((x) => x.id === paidMilestoneId);
    if (!m) return null;
    const total = p.milestones.reduce((s, x) => s + x.amountAda, 0n);
    if (total <= 0n) return null;
    const isLastUnpaid = p.milestones.every((x) => x.paidAt || x.id === paidMilestoneId);
    let share: bigint;
    if (isLastUnpaid) {
      const already = await this.alreadyReturned(p.id);
      share = p.pledgeAmountAda - already;
    } else {
      share = (p.pledgeAmountAda * m.amountAda) / total;
    }
    if (share <= 0n) return null;
    return this.createReturn(p, m.id, share, `milestone #${m.idx + 1} share`);
  }

  /** Sum of pledge already covered by live PLEDGE_RETURN actions (any non-FAILED status). */
  private async alreadyReturned(proposalId: string): Promise<bigint> {
    const rows = await this.prisma.multisigAction.findMany({
      where: { kind: 'PLEDGE_RETURN', proposalId, status: { not: 'FAILED' } },
      select: { amountAda: true },
    });
    return rows.reduce((s, r) => s + (r.amountAda ?? 0n), 0n);
  }

  private async createReturn(
    p: { id: string; title: string; publicId: string | null; pledgeTxHash: string | null },
    milestoneId: string | null,
    lovelace: bigint,
    label: string,
  ) {
    // Dedupe: one live return per milestone (or one full return for LAST_MILESTONE).
    const dup = await this.prisma.multisigAction.findFirst({
      where: { kind: 'PLEDGE_RETURN', proposalId: p.id, milestoneId, status: { not: 'FAILED' } },
      select: { id: true },
    });
    if (dup) return null;

    const dest = await this.cardano.txSenderAddress(p.pledgeTxHash ?? '');
    if (!dest) {
      this.logger.warn(`pledge return for ${p.publicId ?? p.id}: sender address unresolved — board must send manually`);
      return null;
    }
    const source = await this.buckets.defaultBucketFor('PLEDGE');
    const action = await this.prisma.multisigAction.create({
      data: {
        kind: 'PLEDGE_RETURN',
        status: 'PENDING_SIGS',
        amountAda: lovelace,
        description: `Pledge return · ${p.publicId ?? p.title} · ${label}`,
        proposalId: p.id,
        milestoneId,
        proposalTitle: p.title,
        destAddress: dest,
        sourceBucketId: source?.id ?? null,
      },
    });
    this.logger.log(`pledge return prepared: ${action.id} (${Number(lovelace) / 1e6} ₳ → ${dest.slice(0, 20)}…)`);
    return action;
  }
}
