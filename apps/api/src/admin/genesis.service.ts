import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { drepKeyHashFromId } from '@drep-dao/cardano';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AdminAuditService } from './admin-audit.service';

const PROPOSED_KEY = 'admin:genesis:proposed';
const MAX_BOARD = 5;

interface FoundingMember {
  name: string;
  drep_id: string;
}
interface InvalidEntry {
  name: string;
  drep_id: string;
  reason: string;
}
export interface GenesisFile {
  founding_board: FoundingMember[];
}

@Injectable()
export class GenesisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cardano: CardanoQueryService,
    private readonly audit: AdminAuditService,
  ) {}

  private async ensureState() {
    return this.prisma.platformState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }

  /**
   * Forgiving parser — every member is just a name + drep_id. Accepts:
   *   • { "founding_board": [ { "name": "Alice", "drep_id": "drep1..." }, ... ] }
   *   • [ { "name": "Alice", "drep_id": "drep1..." }, ... ]
   *   • { "Alice": "drep1...", "Dave": "drep1..." }            (name → id map)
   *   • [ ["Alice", "drep1..."], ... ]                          (name/id pairs)
   * (drep_id also accepted as drepId / drep / id; name also as Name.)
   */
  private parse(payload: unknown): FoundingMember[] {
    const raw = this.normalize(payload);
    if (raw.length === 0) {
      throw new BadRequestException(
        'no board members found — use a JSON array of { "name": "...", "drep_id": "drep1..." }, ' +
          'or a { "Name": "drep1..." } map.',
      );
    }
    return raw.map((m) => {
      const name = typeof m.name === 'string' ? m.name.trim() : '';
      const drepId = typeof m.drep_id === 'string' ? m.drep_id.trim() : '';
      if (!name) throw new BadRequestException('each member needs a name (string)');
      // Validate the bech32 structure here (not just the drep1 prefix) so a
      // malformed id never reaches Koios — that would otherwise 500.
      if (!drepId || !this.isValidDRepId(drepId)) {
        throw new BadRequestException(
          `invalid drep_id for "${name}": ${drepId || '(missing)'} — must be a valid bech32 drep1… id`,
        );
      }
      return { name, drep_id: drepId };
    });
  }

  /** Split a payload into structurally-valid members and reported invalid entries. */
  private partition(payload: unknown): { valid: FoundingMember[]; invalid: InvalidEntry[] } {
    const raw = this.normalize(payload);
    if (raw.length === 0) {
      throw new BadRequestException(
        'no board members found — use a JSON array of { "name": "...", "drep_id": "drep1..." }, ' +
          'or a { "Name": "drep1..." } map.',
      );
    }
    const valid: FoundingMember[] = [];
    const invalid: InvalidEntry[] = [];
    for (const m of raw) {
      const name = typeof m.name === 'string' ? m.name.trim() : '';
      const drepId = typeof m.drep_id === 'string' ? m.drep_id.trim() : '';
      if (!name) {
        invalid.push({ name: '(unnamed)', drep_id: drepId || '(missing)', reason: 'missing name' });
      } else if (!drepId || !this.isValidDRepId(drepId)) {
        invalid.push({ name, drep_id: drepId || '(missing)', reason: 'not a valid bech32 drep1… id' });
      } else {
        valid.push({ name, drep_id: drepId });
      }
    }
    return { valid, invalid };
  }

  /** True iff the string decodes as a real CIP-129/CIP-105 drep id (28/29 bytes). */
  private isValidDRepId(drepId: string): boolean {
    try {
      drepKeyHashFromId(drepId);
      return true;
    } catch {
      return false;
    }
  }

  private normalize(payload: unknown): { name?: unknown; drep_id?: unknown }[] {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'founding_board' in payload) {
      return this.normalize((payload as GenesisFile).founding_board);
    }
    if (Array.isArray(payload)) return payload.map((e) => this.coerceMember(e));
    if (payload && typeof payload === 'object') {
      // plain object → treat keys as names, values as drep ids
      return Object.entries(payload as Record<string, unknown>).map(([name, drep_id]) => ({ name, drep_id }));
    }
    throw new BadRequestException('unrecognized genesis format — expected a JSON array or object of name + drep_id');
  }

  private coerceMember(e: unknown): { name?: unknown; drep_id?: unknown } {
    if (Array.isArray(e)) return { name: e[0], drep_id: e[1] };
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      return { name: o.name ?? o.Name, drep_id: o.drep_id ?? o.drepId ?? o.drep ?? o.id };
    }
    return {};
  }

  /** Verify on-chain registration; throws if any drep_id is not a registered DRep. */
  private async verifyOrThrow(members: FoundingMember[]) {
    const statuses = await this.cardano.verifyDReps(members.map((m) => m.drep_id));
    const invalid = members.filter((m) => !statuses.get(m.drep_id)?.registered);
    if (invalid.length > 0) {
      throw new BadRequestException(
        `file invalid — not registered DReps on-chain: ${invalid.map((m) => m.drep_id).join(', ')}`,
      );
    }
    return statuses;
  }

  async getState() {
    const state = await this.ensureState();
    const seats = await this.prisma.boardSeat.findMany({ where: { removedAt: null }, orderBy: { addedAt: 'asc' } });
    const proposedRaw = await this.redis.client.get(PROPOSED_KEY);
    const proposed = proposedRaw ? (JSON.parse(proposedRaw) as FoundingMember[]) : null;
    return {
      boardCount: seats.length,
      maxBoard: MAX_BOARD,
      canAddMore: seats.length < MAX_BOARD,
      board: seats.map((s) => ({ displayName: s.displayName, drepId: s.drepId })),
      genesisApprovedAt: state.genesisApprovedAt,
      maintenanceMode: state.maintenanceMode,
      paused: state.paused,
      proposedBoard: proposed,
    };
  }

  /**
   * Validate + verify on-chain + stash the GOOD members for review. Partial by
   * design: structurally-bad or not-registered entries are skipped and reported
   * as `invalid` (with a reason) rather than rejecting the whole file.
   */
  async upload(adminId: string, payload: unknown) {
    const { valid, invalid } = this.partition(payload);

    const statuses = valid.length ? await this.cardano.verifyDReps(valid.map((m) => m.drep_id)) : new Map();
    const registered: FoundingMember[] = [];
    for (const m of valid) {
      if (statuses.get(m.drep_id)?.registered) registered.push(m);
      else invalid.push({ name: m.name, drep_id: m.drep_id, reason: 'not a registered, active DRep on-chain' });
    }

    if (registered.length > 0) {
      await this.redis.client.set(PROPOSED_KEY, JSON.stringify(registered), 'EX', 86400);
    } else {
      await this.redis.client.del(PROPOSED_KEY);
    }
    await this.audit.log({
      adminId,
      action: 'GENESIS_UPLOADED',
      target: `${registered.length} valid, ${invalid.length} skipped`,
    });
    return { proposedBoard: registered, invalid, verified: true };
  }

  /** Seat the stashed (verified) members as board. Incremental; seats up to the cap. */
  async approve(adminId: string, ip?: string, userAgent?: string) {
    await this.ensureState();
    const raw = await this.redis.client.get(PROPOSED_KEY);
    const members: FoundingMember[] = raw ? (JSON.parse(raw) as FoundingMember[]) : [];
    if (members.length === 0) {
      throw new BadRequestException('nothing to install — upload a file with at least one valid, registered DRep');
    }
    const statuses = await this.cardano.verifyDReps(members.map((m) => m.drep_id));

    const current = await this.prisma.boardSeat.count({ where: { removedAt: null } });
    let seated = 0;
    let skippedFull = 0;
    for (const m of members) {
      if (!statuses.get(m.drep_id)?.registered) continue; // defensively skip if it changed on-chain
      const keyHash = statuses.get(m.drep_id)?.keyHashHex ?? drepKeyHashFromId(m.drep_id);
      const exists = await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: keyHash } });
      if (exists) continue; // incremental: skip already-seated
      if (current + seated >= MAX_BOARD) {
        skippedFull++;
        continue; // board full — skip the rest rather than failing the whole op
      }
      await this.prisma.boardSeat.create({
        data: { drepKeyHash: keyHash, drepId: m.drep_id, displayName: m.name },
      });
      seated++;
    }

    await this.prisma.platformState.update({
      where: { id: 1 },
      data: {
        genesisApprovedAt: new Date(),
        genesisApprovedBy: adminId,
        genesisPayload: { founding_board: members } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.redis.client.del(PROPOSED_KEY);
    await this.audit.log({
      adminId,
      action: 'GENESIS_APPROVED',
      target: `+${seated} board (now ${current + seated})${skippedFull ? `, ${skippedFull} skipped (full)` : ''}`,
      payload: { founding_board: members } as unknown as Prisma.InputJsonValue,
      ip,
      userAgent,
    });
    return { seated, skippedFull, boardCount: current + seated, maxBoard: MAX_BOARD };
  }

  async reject(adminId: string) {
    await this.redis.client.del(PROPOSED_KEY);
    await this.audit.log({ adminId, action: 'GENESIS_REJECTED' });
    return { ok: true };
  }

  /** Add a single board member by name + drep_id, verified on-chain. */
  async addBoardMember(adminId: string, name: string, drepId: string, ip?: string, userAgent?: string) {
    const [member] = this.parse([{ name, drep_id: drepId }]); // validates shape + isDRepId
    const statuses = await this.verifyOrThrow([member]); // registered + active on-chain, else 400
    const keyHash = statuses.get(member.drep_id)?.keyHashHex ?? drepKeyHashFromId(member.drep_id);

    if (await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: keyHash } })) {
      throw new ConflictException(`${member.drep_id} is already a board member`);
    }
    if ((await this.prisma.boardSeat.count({ where: { removedAt: null } })) >= MAX_BOARD) {
      throw new ConflictException(`board is capped at ${MAX_BOARD} members — remove one first`);
    }

    await this.prisma.boardSeat.create({
      data: { drepKeyHash: keyHash, drepId: member.drep_id, displayName: member.name },
    });
    await this.markGenesisApproved(adminId);
    await this.audit.log({
      adminId,
      action: 'BOARD_MEMBER_ADDED',
      target: `${member.name} (${member.drep_id})`,
      ip,
      userAgent,
    });
    return this.getState();
  }

  /** Remove a single board member by drep_id (frees a seat; the file can be re-loaded after). */
  async removeBoardMember(adminId: string, drepId: string, ip?: string, userAgent?: string) {
    if (!this.isValidDRepId(drepId)) throw new BadRequestException('drep_id must be a valid bech32 drep1… id');
    const keyHash = drepKeyHashFromId(drepId);
    const seat = await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: keyHash } });
    if (!seat) throw new NotFoundException('not a current board member');

    // §15 — soft-delete so the seat's multisig key (if any) stays linked for
    // signing migration tx out of the old wallet.
    await this.prisma.boardSeat.update({ where: { id: seat.id }, data: { removedAt: new Date() } });
    await this.audit.log({
      adminId,
      action: 'BOARD_MEMBER_REMOVED',
      target: `${seat.displayName} (${seat.drepId})`,
      ip,
      userAgent,
    });
    return this.getState();
  }

  /** Stamp the platform as genesis-bootstrapped on the first seated member. */
  private async markGenesisApproved(adminId: string) {
    const state = await this.ensureState();
    if (!state.genesisApprovedAt) {
      await this.prisma.platformState.update({
        where: { id: 1 },
        data: { genesisApprovedAt: new Date(), genesisApprovedBy: adminId },
      });
    }
  }
}
