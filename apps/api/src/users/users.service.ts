import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, DRepStatus } from '@drep-dao/shared';
import { drepIdFromKeyHashHex } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { isProvenDrepRequired } from '../auth/drep-link.service';

export interface UserProfile {
  user: {
    id: string;
    stakeAddress: string;
    stakeKeyHash: string;
    displayName: string | null;
    createdAt: Date;
  };
  /** §2 — the submitter profile's own name (may differ from the DAO-member name). */
  submitterName: string | null;
  roles: Role[];
  /** On-chain DRep identity — the source of truth for the DREP role (§22.4). */
  onchainDrep: { registered: boolean; drepId: string | null; proven?: boolean };
  /** DAO membership (admission) status — separate from on-chain registration. */
  daoMembership: { status: string; admittedAt: Date | null } | null;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
    private readonly config: ConfigService,
  ) {}

  /** §22.1 — auto-create (or refresh) a user keyed by stake key hash on login.
   * Records the wallet's CIP-95 DRep key hash (if provided) and, if present,
   * checks on-chain whether that DRep is registered + active (§22.4). */
  async upsertByStakeKey(params: { stakeKeyHash: string; stakeAddress: string; drepKeyHash?: string }) {
    // SEC-01 (interim hardening) — a login proves control of the STAKE key only, not the supplied
    // DRep key. Until a full DRep-key-ownership proof exists, the DRep binding is first-write-wins,
    // immutable through normal login, and globally unique — so a caller can't claim another party's
    // (e.g. a board seat's) public DRep key. A full cryptographic proof flow supersedes this.
    const existing = await this.prisma.appUser.findUnique({ where: { stakeKeyHash: params.stakeKeyHash }, select: { drepKeyHash: true } });
    // SEC-01 — when a cryptographic DRep proof is required, a plain login must NOT bind the
    // client-supplied DRep key at all; binding happens only through /auth/drep/verify.
    let drepKeyHash = isProvenDrepRequired(this.config) ? undefined : params.drepKeyHash ?? undefined;
    if (drepKeyHash) {
      if (existing?.drepKeyHash) {
        drepKeyHash = undefined; // immutable: keep the already-bound key, ignore a different claim
      } else {
        const taken = await this.prisma.appUser.findFirst({ where: { drepKeyHash, NOT: { stakeKeyHash: params.stakeKeyHash } }, select: { id: true } });
        if (taken) {
          this.logger.warn(`refusing to bind DRep key hash already claimed by another account (stake ${params.stakeKeyHash.slice(0, 12)}…)`);
          drepKeyHash = undefined;
        }
      }
    }
    // undefined = couldn't determine (no key, or chain query failed) → preserve prior value.
    // Refresh registration for the effective key (existing binding or the just-bound key) so a member
    // who registers their DRep on-chain after first login still gets drepRegistered updated.
    const effectiveKey = existing?.drepKeyHash ?? drepKeyHash;
    const registered = effectiveKey ? await this.checkOnchainRegistration(effectiveKey) : undefined;
    return this.prisma.appUser.upsert({
      where: { stakeKeyHash: params.stakeKeyHash },
      update: {
        stakeAddress: params.stakeAddress,
        ...(drepKeyHash ? { drepKeyHash } : {}),
        ...(registered !== undefined ? { drepRegistered: registered } : {}),
      },
      create: {
        stakeKeyHash: params.stakeKeyHash,
        stakeAddress: params.stakeAddress,
        drepKeyHash,
        drepRegistered: registered ?? false,
      },
    });
  }

  /** Board members are admitted DAO members by definition — give them a profile row. */
  private async ensureBoardMembershipRow(userId: string, drepKeyHash: string) {
    const drepId = safeDrepId(drepKeyHash);
    if (!drepId) return null;
    try {
      return await this.prisma.drep.create({
        data: {
          userId,
          drepIdOnchain: drepId,
          status: DRepStatus.ADMITTED,
          admittedAt: new Date(),
          subcategoryIds: [],
        },
      });
    } catch {
      // race / unique conflict — re-fetch whatever exists now.
      return this.prisma.drep.findUnique({ where: { userId } });
    }
  }

  /** Is this CIP-95 DRep key a registered + active on-chain DRep? undefined if unknown. */
  private async checkOnchainRegistration(drepKeyHash: string): Promise<boolean | undefined> {
    try {
      const drepId = drepIdFromKeyHashHex(drepKeyHash);
      const statuses = await this.cardano.verifyDReps([drepId]);
      return statuses.get(drepId)?.registered ?? false;
    } catch (e) {
      this.logger.warn(`on-chain DRep check failed for ${drepKeyHash}: ${e instanceof Error ? e.message : e}`);
      return undefined;
    }
  }

  /** Profile + derived roles (§2). Returns null if the user no longer exists. */
  /** §20 — this member's personal block-explorer preference (null = use the platform default). */
  async getPreferences(userId: string) {
    const u = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { explorerPref: true, explorerCustomTxUrl: true },
    });
    return { explorer: u?.explorerPref ?? null, explorerCustomTxUrl: u?.explorerCustomTxUrl ?? null };
  }

  async setPreferences(userId: string, dto: { explorer?: string | null; explorerCustomTxUrl?: string | null }) {
    await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        ...(dto.explorer !== undefined ? { explorerPref: dto.explorer || null } : {}),
        ...(dto.explorerCustomTxUrl !== undefined ? { explorerCustomTxUrl: dto.explorerCustomTxUrl || null } : {}),
      },
    });
    return this.getPreferences(userId);
  }

  /** §15.4 — DReps + board members provide a payment address for rewards.
   *  Edited freely; RewardEntry stamps `paidToAddress` at payment time so
   *  past payouts always show their then-current destination. */
  async getRewardPaymentAddress(userId: string) {
    const u = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { rewardPaymentAddress: true } });
    return { rewardPaymentAddress: u?.rewardPaymentAddress ?? null };
  }
  async setRewardPaymentAddress(userId: string, address: string | null) {
    const v = (address ?? '').trim();
    if (v && !/^addr(_test)?[a-z0-9]+$/i.test(v)) {
      throw new Error('payment address must be a Cardano bech32 address (addr… / addr_test…)');
    }
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { rewardPaymentAddress: v || null },
    });
    return this.getRewardPaymentAddress(userId);
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      include: { drep: { include: { boardMemberships: true } }, experts: true, submitterApplication: { select: { status: true, displayName: true } } },
    });
    if (!user) return null;

    // §17.5 — board membership is keyed by the wallet's on-chain DRep key hash
    // matching a genesis board seat (NOT by stake address / a DB flag).
    const seat = user.drepKeyHash
      ? await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: user.drepKeyHash } })
      : null;
    const isBoard = seat !== null;

    // Board members get their seat name as a display name (so it shows in the
    // login card, vote lists, and members overview) unless they've set their own.
    let displayName = user.displayName;
    if (seat && !displayName) {
      displayName = seat.displayName;
      await this.prisma.appUser.update({ where: { id: user.id }, data: { displayName } });
    }
    // §2 — a viewer/expert/submitter who never set a DAO-member name still has a
    // name from their expert or submitter profile. Adopt it as the account name
    // (persisted) so it shows in the login card, vote lists, directories, etc.
    if (!displayName) {
      const expertName = user.experts.find((e) => !e.leftAt && e.displayName?.trim())?.displayName?.trim();
      const submitterName = user.submitterApplication?.displayName?.trim();
      const fallback = expertName || submitterName || null;
      if (fallback) {
        displayName = fallback;
        await this.prisma.appUser.update({ where: { id: user.id }, data: { displayName } });
      }
    }

    // §22.4 — DREP is an on-chain role: the wallet IS a registered+active DRep
    // (verified via Koios at login), NOT a status we grant in our DB. Wallets
    // that aren't registered on-chain are plain ADA holders (viewer/submitter).
    const isRegisteredDRep = user.drepRegistered;

    // §2/§14 — board members are DAO members by definition; they don't apply.
    // Ensure they have a profile row (ADMITTED) so they can edit bio/etc. and
    // appear in the members overview.
    let drep: { status: string; admittedAt: Date | null } | null = user.drep;
    if (isBoard && !drep && user.drepKeyHash) {
      drep = await this.ensureBoardMembershipRow(user.id, user.drepKeyHash);
    }

    // A non-board DAO member must still be a registered on-chain DRep; if their
    // registration lapses they fall back to ADA holder (board seats are exempt).
    const isDaoMember = isBoard || (drep?.status === DRepStatus.ADMITTED && isRegisteredDRep);

    const roles: Role[] = [Role.VIEWER];
    if (isRegisteredDRep || isBoard) roles.push(Role.DREP);
    if (isDaoMember) roles.push(Role.DAO_MEMBER);
    if (isBoard) roles.push(Role.BOARD);
    // §2 Expert — a non-DRep approved by the board (and who hasn't left).
    if (user.experts.some((e) => e.approvedByBoard && !e.leftAt)) {
      roles.push(Role.EXPERT);
    }
    // §2.1 Submitter — granted only once the board approves the submitter application.
    if (user.submitterApplication?.status === 'APPROVED') {
      roles.push(Role.SUBMITTER);
    }

    return {
      user: {
        id: user.id,
        stakeAddress: user.stakeAddress,
        stakeKeyHash: user.stakeKeyHash,
        displayName,
        createdAt: user.createdAt,
      },
      // §2 — the submitter's own profile name (may differ from the DAO-member
      // name). Lets the login card show "Member name (Submitter name)" without
      // enforcing a single name across roles.
      submitterName: user.submitterApplication?.displayName ?? null,
      roles,
      onchainDrep: {
        registered: isRegisteredDRep,
        drepId: user.drepKeyHash ? safeDrepId(user.drepKeyHash) : null,
        proven: !!user.drepKeyProvenAt,
      },
      daoMembership: drep ? { status: drep.status, admittedAt: drep.admittedAt } : null,
    };
  }
}

/** CIP-129 drep1… from a stored 28-byte DRep key hash; null on malformed input. */
function safeDrepId(drepKeyHash: string): string | null {
  try {
    return drepIdFromKeyHashHex(drepKeyHash);
  } catch {
    return null;
  }
}
