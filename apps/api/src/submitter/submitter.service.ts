import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { MeritService } from '../merit/merit.service';
import { AnchorService } from '../cardano/anchor.service';
import { GovSubject } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import type { SubmitterApplicationDto } from './dto';

const MIN_DESCRIPTION_WORDS = 100;

/**
 * §2.1 — submitter role. A user applies with a profile form; a board member approves or rejects
 * (with a reason). Only an APPROVED submitter may create/submit proposals. Any account type
 * (viewer, DAO member, board) needs it.
 */
@Injectable()
export class SubmitterService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly merit?: MeritService,
    @Optional() private readonly anchor?: AnchorService,
  ) {}

  /** §13.2 — reviewing a submitter application is board work: +1 merit, once per application. */
  private async awardReviewMerit(reviewerUserId: string | undefined, applicationId: string) {
    if (!reviewerUserId) return;
    const drep = await this.prisma.drep.findUnique({ where: { userId: reviewerUserId }, select: { id: true } });
    if (drep) await this.merit?.tryAward(drep.id, 'APPLICATION_REVIEW', applicationId);
  }

  private wordCount(s: string): number {
    return s.trim().split(/\s+/).filter(Boolean).length;
  }

  async apply(userId: string, dto: SubmitterApplicationDto) {
    // §2 — the submitter profile is INDEPENDENT of the DAO-member / DRep profile: it carries
    // its own display name. We no longer force the account's profile name onto it, so a member
    // can present a different name as a submitter (e.g. their company). Required, provided here.
    const me = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    const displayName = (dto.displayName ?? '').trim();
    const description = (dto.description ?? '').trim();
    const country = (dto.country ?? '').trim();
    if (!displayName) throw new BadRequestException('display name is required');
    // §2.1 — applying means consenting to profile persistence (it stays even after leaving).
    const prior = await this.prisma.submitterApplication.findUnique({ where: { userId }, select: { status: true } });
    if (prior?.status !== 'APPROVED' && !dto.agreePersist) {
      throw new BadRequestException('you must agree that the profile will be persisted by the platform');
    }
    if (!country) throw new BadRequestException('country is required');
    if (!description) throw new BadRequestException('description is required');
    // §2.1 — disclosure + contact (the board must be able to reach the team).
    const conflictOfInterest = (dto.conflictOfInterest ?? '').trim();
    if (!conflictOfInterest) throw new BadRequestException('the conflict-of-interest disclosure is required (write "none" if you have none)');
    const telegram = (dto.telegram ?? '').trim();
    if (!telegram) throw new BadRequestException('a Telegram handle is required');
    const email = (dto.email ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('a valid email is required');
    const previousFunding = (dto.previousFunding ?? '').trim();
    const socialLinks = (dto.socialLinks ?? []).map((s) => s.trim()).filter(Boolean);
    const githubUrls = (dto.githubUrls ?? []).map((s) => s.trim()).filter(Boolean);
    const logoDataUrl = dto.logoDataUrl?.trim() || null;
    const existing = await this.prisma.submitterApplication.findUnique({ where: { userId } });
    // The 100-word minimum is for applications the board still has to review. An already-approved
    // member can refine their profile without re-meeting it (e.g. grandfathered placeholder text).
    if (existing?.status !== 'APPROVED' && this.wordCount(description) < MIN_DESCRIPTION_WORDS) {
      throw new BadRequestException(`description must be at least ${MIN_DESCRIPTION_WORDS} words`);
    }
    // Approved members can edit their profile without losing the role; everyone else (new or
    // previously rejected) goes back to PENDING for board review.
    const status = existing?.status === 'APPROVED' ? 'APPROVED' : 'PENDING';
    // Preserve the change history: snapshot the previous APPROVED profile before overwriting it.
    const changed = !!existing && (
      existing.displayName !== displayName ||
      existing.description !== description ||
      JSON.stringify(existing.githubUrls) !== JSON.stringify(githubUrls) ||
      JSON.stringify(existing.socialLinks) !== JSON.stringify(socialLinks) ||
      (existing.logoDataUrl ?? null) !== logoDataUrl ||
      existing.country !== country ||
      existing.conflictOfInterest !== conflictOfInterest ||
      existing.noSelfVotePledge !== !!dto.noSelfVotePledge ||
      existing.telegram !== telegram ||
      existing.email !== email ||
      existing.previousFunding !== previousFunding
    );
    if (existing && existing.status === 'APPROVED' && changed) {
      await this.prisma.submitterApplicationHistory.create({
        data: {
          userId,
          displayName: existing.displayName,
          description: existing.description,
          githubUrls: existing.githubUrls,
          socialLinks: existing.socialLinks,
          logoDataUrl: existing.logoDataUrl,
          country: existing.country,
          conflictOfInterest: existing.conflictOfInterest,
          noSelfVotePledge: existing.noSelfVotePledge,
          telegram: existing.telegram,
          email: existing.email,
          previousFunding: existing.previousFunding,
        },
      });
    }
    // §2 — cross-wallet link to a DAO-member profile (empty string clears it).
    const linkedDrepIdOnchain = dto.linkedDrepIdOnchain?.trim() || null;
    const data = { status, displayName, description, githubUrls, socialLinks, logoDataUrl, country, conflictOfInterest, noSelfVotePledge: !!dto.noSelfVotePledge, telegram, email, previousFunding, linkedDrepIdOnchain, rejectionReason: null };
    await this.prisma.submitterApplication.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    // Viewers: sync the name to the account so it shows in the login section + on proposals.
    // (Members already had it — never overwrite the profile from here.)
    if (!me?.displayName?.trim()) {
      await this.prisma.appUser.update({ where: { id: userId }, data: { displayName } });
    }
    return this.mine(userId);
  }

  private async historyFor(userId: string) {
    const rows = await this.prisma.submitterApplicationHistory.findMany({ where: { userId }, orderBy: { snapshotAt: 'desc' } });
    return rows.map((h) => ({
      displayName: h.displayName,
      description: h.description,
      githubUrls: h.githubUrls,
      socialLinks: h.socialLinks,
      logoDataUrl: h.logoDataUrl,
      country: h.country,
      conflictOfInterest: h.conflictOfInterest,
      noSelfVotePledge: h.noSelfVotePledge,
      telegram: h.telegram,
      email: h.email,
      previousFunding: h.previousFunding,
      snapshotAt: h.snapshotAt,
    }));
  }

  async mine(userId: string) {
    const a = await this.prisma.submitterApplication.findUnique({ where: { userId } });
    if (!a) return null;
    const linkedMember = await this.resolveLinkedMember(userId, a.linkedDrepIdOnchain);
    return {
      id: a.id,
      status: a.status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'LEFT',
      displayName: a.displayName,
      // §2 — the DAO-member profile this submitter declared (own selection) + the resolved
      // linked member (which also reflects a link declared from the DAO-member side).
      linkedDrepIdOnchain: a.linkedDrepIdOnchain,
      linkedDaoMember: linkedMember,
      description: a.description,
      githubUrls: a.githubUrls,
      socialLinks: a.socialLinks,
      logoDataUrl: a.logoDataUrl,
      country: a.country,
      conflictOfInterest: a.conflictOfInterest,
      noSelfVotePledge: a.noSelfVotePledge,
      telegram: a.telegram,
      email: a.email,
      previousFunding: a.previousFunding,
      rejectionReason: a.rejectionReason,
      leftAt: a.leftAt,
      history: await this.historyFor(userId),
    };
  }

  /**
   * §2.1 — an approved submitter deregisters. Blocked while any of their proposals is still
   * in flight (PENDING / ACTIVE / APPROVED): finish it, or the board cancels it. The profile
   * row is KEPT (status LEFT + leftAt) — it stays visible in the directory's history view.
   */
  async leave(userId: string) {
    const a = await this.prisma.submitterApplication.findUnique({ where: { userId }, select: { id: true, status: true } });
    if (!a || a.status !== 'APPROVED') throw new ConflictException('only an approved submitter can leave');
    const active = await this.prisma.proposal.count({
      where: { submitterUserId: userId, status: { in: ['PENDING', 'ACTIVE', 'APPROVED'] } },
    });
    if (active > 0) {
      throw new ConflictException(
        `you cannot leave while you have ${active} active proposal${active === 1 ? '' : 's'} — finish ${active === 1 ? 'it' : 'them'} first, or ask the board to cancel ${active === 1 ? 'it' : 'them'}`,
      );
    }
    await this.prisma.submitterApplication.update({ where: { id: a.id }, data: { status: 'LEFT', leftAt: new Date() } });
    return { ok: true };
  }

  async isApproved(userId: string): Promise<boolean> {
    const a = await this.prisma.submitterApplication.findUnique({ where: { userId }, select: { status: true } });
    return a?.status === 'APPROVED';
  }

  /**
   * §2 — resolve the DAO-member profile linked to a submitter, by SAME wallet (the submitter's
   * own account is an admitted DRep) OR by an explicit cross-wallet link declared from either
   * side. Returns the member's on-chain DRep id + name so the profile can cross-link.
   */
  private async resolveLinkedMember(userId: string, linkedDrepIdOnchain: string | null) {
    const explicit = await this.prisma.drep.findFirst({
      where: {
        status: 'ADMITTED',
        OR: [
          ...(linkedDrepIdOnchain ? [{ drepIdOnchain: linkedDrepIdOnchain }] : []),
          { linkedSubmitterUserId: userId },
        ],
      },
      select: { drepIdOnchain: true, userId: true, user: { select: { displayName: true } } },
    });
    if (explicit) return { drepIdOnchain: explicit.drepIdOnchain, name: explicit.user.displayName ?? '', crossWallet: explicit.userId !== userId };
    const same = await this.prisma.drep.findFirst({ where: { userId, status: 'ADMITTED' }, select: { drepIdOnchain: true, user: { select: { displayName: true } } } });
    if (same) return { drepIdOnchain: same.drepIdOnchain, name: same.user.displayName ?? '', crossWallet: false };
    return null;
  }

  /**
   * §3 — validate a payout/refund address: is it a well-formed Cardano address on the right
   * network, and does it belong to the submitter's OWN wallet (same stake key) or a different
   * wallet (foreign — a valid choice, just flagged)? CSL is imported lazily so the unit tests
   * (which never call this) don't pull in the native lib.
   */
  async checkAddress(userId: string, address: string): Promise<{ valid: boolean; networkOk: boolean; mine: boolean; hasStakePart: boolean }> {
    const trimmed = (address ?? '').trim();
    const fail = { valid: false, networkOk: false, mine: false, hasStakePart: false };
    if (!trimmed) return fail;
    const CSL = await import('@emurgo/cardano-serialization-lib-nodejs');
    try {
      const addr = CSL.Address.from_bech32(trimmed);
      const expectedNet = (process.env.CARDANO_NETWORK ?? 'Preprod') === 'Mainnet' ? 1 : 0;
      const networkOk = addr.network_id() === expectedNet;
      const stakeCred = CSL.BaseAddress.from_address(addr)?.stake_cred() ?? null;
      let mine = false;
      if (stakeCred) {
        const me = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { stakeAddress: true } });
        if (me?.stakeAddress) {
          try {
            const reward = CSL.RewardAddress.new(addr.network_id(), stakeCred).to_address().to_bech32();
            mine = reward === me.stakeAddress;
          } catch { /* credential not key-based — leave mine=false */ }
        }
      }
      return { valid: true, networkOk, mine, hasStakePart: !!stakeCred };
    } catch {
      return fail;
    }
  }

  /** §2 (board) — override a submitter's cross-wallet link to a DAO member (set or clear). */
  async setLink(appId: string, linkedDrepIdOnchain: string | null) {
    const a = await this.prisma.submitterApplication.findUnique({ where: { id: appId }, select: { userId: true } });
    if (!a) throw new NotFoundException('submitter profile not found');
    await this.prisma.submitterApplication.update({ where: { id: appId }, data: { linkedDrepIdOnchain: linkedDrepIdOnchain?.trim() || null } });
    return this.mine(a.userId);
  }

  /** §2.1 — public directory of APPROVED submitters; flags those who are also DAO members. */
  async listApproved(includeLeft = false) {
    const rows = await this.prisma.submitterApplication.findMany({
      where: { status: includeLeft ? { in: ['APPROVED', 'LEFT'] } : 'APPROVED' },
      orderBy: { displayName: 'asc' },
      include: { user: { select: { id: true, displayName: true, stakeAddress: true, drepKeyHash: true, drep: { select: { status: true, drepIdOnchain: true } } } } },
    });
    const boardKeys = new Set(
      (await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    return Promise.all(rows.map(async (a) => {
      const linkedMember = await this.resolveLinkedMember(a.user.id, a.linkedDrepIdOnchain);
      const isDaoMember = !!linkedMember || a.user.drep?.status === 'ADMITTED' || (!!a.user.drepKeyHash && boardKeys.has(a.user.drepKeyHash));
      const ownName = a.displayName?.trim() || '';
      return {
      id: a.id,
      // The submitter's account id — the value a DAO member selects to link to this profile.
      userId: a.user.id,
      // §2 — the submitter's OWN profile name is primary here; the DAO-member
      // name (if they're also a member) is surfaced separately as context.
      displayName: ownName || a.user.displayName || '',
      // The DAO-member name + on-chain id, when this submitter is also a DAO member.
      daoMemberName: linkedMember && linkedMember.name && linkedMember.name !== ownName ? linkedMember.name : null,
      daoMemberDrepId: linkedMember?.drepIdOnchain ?? null,
      description: a.description,
      country: a.country,
      githubUrls: a.githubUrls,
      socialLinks: a.socialLinks,
      logoDataUrl: a.logoDataUrl,
      noSelfVotePledge: a.noSelfVotePledge,
      conflictOfInterest: a.conflictOfInterest,
      telegram: a.telegram,
      email: a.email,
      previousFunding: a.previousFunding,
      // The platform knows the wallet — expose it (and the DRep identity when they have one).
      stakeAddress: a.user.stakeAddress,
      drepIdOnchain: a.user.drep?.drepIdOnchain ?? null,
      // §2.1 — important context: this submitter also votes (DAO member / board).
      isDaoMember,
      status: a.status as 'APPROVED' | 'LEFT',
      leftAt: a.leftAt,
      since: a.reviewedAt,
      };
    }));
  }

  /**
   * §2.1 — a submitter's funding-proposal portfolio + headline stats, shown at the
   * bottom of their profile. Keyed by the APPLICATION id (what the directory uses).
   * Counts only FUNDING proposals that entered the process (DRAFTs excluded).
   *
   * Stats:
   *  - submitted: how many proposals they ran through the DAO
   *  - requestedAda: total budget asked across all of them
   *  - approvedAda: budget granted (proposals that reached APPROVED/COMPLETE)
   *  - paidAda: actually sent so far (sum of milestones marked paid on-chain)
   *  - completed: proposals fully delivered (COMPLETE)
   *  - inProgress: funded but not yet complete (APPROVED) + missingMilestones across them
   */
  async submitterPortfolio(applicationId: string) {
    const app = await this.prisma.submitterApplication.findUnique({
      where: { id: applicationId },
      select: { userId: true },
    });
    if (!app) throw new NotFoundException('submitter not found');

    const ADA = 1_000_000;
    const rows = await this.prisma.proposal.findMany({
      where: { submitterUserId: app.userId, type: 'FUNDING', status: { not: 'DRAFT' } },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true, publicId: true, title: true, status: true, stage: true,
        requestedAmountAda: true,
        round: { select: { number: true, name: true } },
        milestones: { select: { amountAda: true, paidAt: true } },
      },
    });

    const FUNDED = new Set(['APPROVED', 'COMPLETE']);
    let requestedLov = 0n, approvedLov = 0n, paidLov = 0n;
    let completed = 0, inProgress = 0, missingMilestones = 0, rejected = 0;

    const proposals = rows.map((p) => {
      const requested = p.requestedAmountAda ?? 0n;
      requestedLov += requested;
      const msTotal = p.milestones.length;
      const msPaid = p.milestones.filter((m) => m.paidAt).length;
      const paid = p.milestones.reduce((s, m) => s + (m.paidAt ? m.amountAda : 0n), 0n);
      paidLov += paid;
      if (FUNDED.has(p.status)) approvedLov += requested;
      if (p.status === 'COMPLETE') completed += 1;
      // Rejected at filtering / debate & vote (not the same as a funded project later stopped).
      if (p.status === 'REJECTED') rejected += 1;
      // Funded but not yet complete → in progress; its unpaid milestones are "missing".
      if (p.status === 'APPROVED') {
        inProgress += 1;
        missingMilestones += msTotal - msPaid;
      }
      return {
        id: p.id,
        publicId: p.publicId,
        title: p.title,
        status: p.status,
        stage: p.stage,
        roundNumber: p.round?.number ?? null,
        roundName: p.round?.name ?? null,
        requestedAda: Number(requested) / ADA,
        milestonesTotal: msTotal,
        milestonesPaid: msPaid,
        paidAda: Number(paid) / ADA,
      };
    });

    return {
      proposals,
      stats: {
        submitted: rows.length,
        requestedAda: Number(requestedLov) / ADA,
        approvedAda: Number(approvedLov) / ADA,
        paidAda: Number(paidLov) / ADA,
        completed,
        inProgress,
        rejected,
        missingMilestones,
      },
    };
  }

  /** §2.1/§14 — public count of applications awaiting board approval (no content), plus whether
   *  a board is seated. Submitter applications ALWAYS need board approval — during the
   *  pre-election "free period" they simply queue until the first board exists. */
  async pendingPublicCount() {
    const [count, boardSeats] = await Promise.all([
      this.prisma.submitterApplication.count({ where: { status: 'PENDING' } }),
      this.prisma.boardSeat.count({ where: { removedAt: null } }),
    ]);
    return { count, boardElected: boardSeats > 0 };
  }

  /** Board to-do: applications awaiting review (or all, with showAll). Each carries its change history. */
  async listApplications(showAll = false) {
    const rows = await this.prisma.submitterApplication.findMany({
      where: showAll ? {} : { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { stakeAddress: true } } },
    });
    const hist = await this.prisma.submitterApplicationHistory.findMany({
      where: { userId: { in: rows.map((r) => r.userId) } },
      orderBy: { snapshotAt: 'desc' },
    });
    const histByUser = new Map<string, ReturnType<typeof mapHist>[]>();
    function mapHist(h: (typeof hist)[number]) {
      return { displayName: h.displayName, description: h.description, githubUrls: h.githubUrls, socialLinks: h.socialLinks, logoDataUrl: h.logoDataUrl, country: h.country, conflictOfInterest: h.conflictOfInterest, noSelfVotePledge: h.noSelfVotePledge, telegram: h.telegram, email: h.email, previousFunding: h.previousFunding, snapshotAt: h.snapshotAt };
    }
    for (const h of hist) {
      if (!histByUser.has(h.userId)) histByUser.set(h.userId, []);
      histByUser.get(h.userId)!.push(mapHist(h));
    }
    return rows.map((a) => ({
      id: a.id,
      status: a.status as 'PENDING' | 'APPROVED' | 'REJECTED',
      displayName: a.displayName,
      description: a.description,
      githubUrls: a.githubUrls,
      socialLinks: a.socialLinks,
      logoDataUrl: a.logoDataUrl,
      country: a.country,
      conflictOfInterest: a.conflictOfInterest,
      noSelfVotePledge: a.noSelfVotePledge,
      telegram: a.telegram,
      email: a.email,
      previousFunding: a.previousFunding,
      rejectionReason: a.rejectionReason,
      stakeAddress: a.user.stakeAddress,
      history: histByUser.get(a.userId) ?? [],
    }));
  }

  async approve(id: string, reviewerUserId?: string) {
    const a = await this.prisma.submitterApplication.findUnique({ where: { id }, include: { user: { select: { id: true, displayName: true } } } });
    if (!a) throw new NotFoundException('application not found');
    // §2.1 — nobody reviews their own application (self-approval + merit farming).
    if (reviewerUserId && a.userId === reviewerUserId) {
      throw new ForbiddenException('you cannot review your own application — another board member must decide it');
    }
    await this.prisma.submitterApplication.update({ where: { id }, data: { status: 'APPROVED', rejectionReason: null, reviewedAt: new Date() } });
    await this.awardReviewMerit(reviewerUserId, id);
    // §24.1 — anchor the admission on-chain: short proof with name + wallet identity
    // (DRep ID when they have one, else the stake address). Best-effort.
    try {
      const who = await this.prisma.appUser.findUnique({
        where: { id: a.user.id },
        select: { stakeAddress: true, displayName: true, drep: { select: { drepIdOnchain: true } } },
      });
      await this.anchor?.anchorMembership({
        kind: GovSubject.SUBMITTER_ADMISSION,
        event: 'new submitter admitted',
        name: who?.displayName ?? a.displayName,
        walletKind: who?.drep ? 'drep_id' : 'stake_address',
        walletId: who?.drep?.drepIdOnchain ?? who?.stakeAddress ?? '',
      });
    } catch { /* anchoring never blocks the approval */ }
    // Give the user a display name from the application if they don't have one yet — so their
    // proposals show a name instead of a stake id.
    if (!a.user.displayName) {
      await this.prisma.appUser.update({ where: { id: a.user.id }, data: { displayName: a.displayName } });
    }
    return { ok: true };
  }

  async reject(id: string, reason: string, reviewerUserId?: string) {
    const r = (reason ?? '').trim();
    if (!r) throw new BadRequestException('a reason is required to reject — the applicant will see it');
    const a = await this.prisma.submitterApplication.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!a) throw new NotFoundException('application not found');
    if (reviewerUserId && a.userId === reviewerUserId) {
      throw new ForbiddenException('you cannot review your own application — another board member must decide it');
    }
    await this.prisma.submitterApplication.update({ where: { id }, data: { status: 'REJECTED', rejectionReason: r, reviewedAt: new Date() } });
    await this.awardReviewMerit(reviewerUserId, id);
    return { ok: true };
  }

  /** Guard helper for proposal create/submit. */
  async assertApproved(userId: string) {
    if (!(await this.isApproved(userId))) {
      throw new ForbiddenException('you must be an approved submitter to submit proposals — apply for the submitter role first');
    }
  }
}
