import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';

const LOVELACE = 1_000_000;
const MAX_LABEL_LEN = 64;

/** §15.6 — every operation kind whose default bucket the board can pick. */
export type BucketOperation =
  | 'FUNDING' | 'REWARDS' | 'OPERATIONS'   // outbound
  | 'SUBMISSION_FEES' | 'PLEDGE';          // inbound

const OPERATION_COLUMN: Record<BucketOperation, string> = {
  FUNDING:         'isDefaultFunding',
  REWARDS:         'isDefaultRewards',
  OPERATIONS:      'isDefaultOperations',
  SUBMISSION_FEES: 'isDefaultSubmissionFees',
  PLEDGE:          'isDefaultPledge',
};

/**
 * §15.5 — labeled treasury buckets (sub-addresses of the same multisig).
 *
 * Each bucket is an on-chain Cardano address with a DIFFERENT script hash
 * than the primary multisig — but it still requires the same N board
 * signatures to spend, because the bucket's script is:
 *
 *   ScriptAll [
 *     <the active multisig ScriptAll(N board keys)>,
 *     ScriptNOfK(0, [Ed25519KeyHash(sha256(label).slice(0, 28))])
 *   ]
 *
 * The inner 0-of-1 clause requires zero signatures (always satisfied) so it
 * doesn't add a signing requirement — its only purpose is to embed the
 * label's hash in the script bytes so the wrapped script hashes differently,
 * giving each bucket a distinct address. The board UX is identical: same
 * Approve&sign queue, same N-of-N requirement.
 *
 * The PRIMARY bucket is the bare multisig script (no wrap, no label). It's
 * auto-created the first time the buckets list is queried after a new
 * MultisigConfig is assembled, so every multisig has at least one bucket
 * pointing at its canonical address.
 */
@Injectable()
export class TreasuryBucketsService {
  private readonly networkId: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cardano: CardanoQueryService,
  ) {
    const net = (this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod').trim();
    this.networkId = net === 'Mainnet' ? 1 : 0;
  }

  /** List every bucket under the active multisig, with live balances. */
  async list() {
    const active = await this.prisma.multisigConfig.findFirst({
      where: { replacedAt: null },
      orderBy: { assembledAt: 'desc' },
    });
    if (!active) return { multisigConfigured: false, buckets: [] as Array<{ id: string; label: string; bech32Address: string; isPrimary: boolean; balanceAda: number; createdBy: string | null }> };
    // Auto-create the primary bucket so the list is never empty when a
    // multisig exists.
    await this.ensurePrimary(active.id, active.bech32Address, active.scriptJson as object, active.scriptHash);

    const rows = await this.prisma.treasuryBucket.findMany({
      where: { configId: active.id },
      include: { createdBy: { select: { displayName: true } } },
      // primary first, then newest first
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    const balMap = await this.cardano
      .addressBalance(rows.map((r) => r.bech32Address))
      .catch(() => new Map<string, bigint>());
    return {
      multisigConfigured: true,
      buckets: rows.map((r) => ({
        id: r.id,
        label: r.label || 'Primary',
        bech32Address: r.bech32Address,
        isPrimary: r.isPrimary,
        isDefaultFunding: r.isDefaultFunding,
        isDefaultRewards: r.isDefaultRewards,
        isDefaultOperations: r.isDefaultOperations,
        isDefaultSubmissionFees: r.isDefaultSubmissionFees,
        isDefaultPledge: r.isDefaultPledge,
        balanceAda: Number(balMap.get(r.bech32Address) ?? 0n) / LOVELACE,
        createdBy: r.createdBy?.displayName ?? null,
      })),
    };
  }

  /** Board member creates a labeled bucket under the active multisig. */
  async create(userId: string, label: string) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    const trimmed = (label ?? '').trim();
    if (trimmed.length < 2 || trimmed.length > MAX_LABEL_LEN) {
      throw new BadRequestException(`label must be 2–${MAX_LABEL_LEN} characters`);
    }
    if (trimmed.toLowerCase() === 'primary') {
      throw new BadRequestException('"Primary" is reserved for the bare multisig bucket');
    }
    const active = await this.prisma.multisigConfig.findFirst({
      where: { replacedAt: null },
      orderBy: { assembledAt: 'desc' },
    });
    if (!active) throw new ConflictException('no active multisig — assemble the board signing keys first');

    // Reject duplicates (same label under the same config).
    const dup = await this.prisma.treasuryBucket.findFirst({ where: { configId: active.id, label: trimmed } });
    if (dup) throw new ConflictException('a bucket with that label already exists');

    const built = this.buildLabeledScript(active.scriptJson as object, trimmed);
    return this.prisma.treasuryBucket.create({
      data: {
        configId: active.id,
        label: trimmed,
        scriptJson: built.scriptJson,
        scriptHash: built.scriptHash,
        bech32Address: built.bech32Address,
        isPrimary: false,
        createdById: userId,
      },
      select: { id: true, label: true, bech32Address: true, scriptHash: true },
    });
  }

  /** Look up a bucket by id, returning the full script JSON so the broadcast
   *  service can build a tx out of it. */
  async findById(bucketId: string) {
    return this.prisma.treasuryBucket.findUnique({ where: { id: bucketId } });
  }

  /** §15.5 — cosmetic rename. Label inside the script bytes is FROZEN at
   *  creation (it's part of the script_hash and on-chain address); changing
   *  the displayed label here doesn't move funds. Renaming the PRIMARY is
   *  allowed (e.g. to give it a domain-specific name like "Funding") — the
   *  isPrimary flag stays true and its bare-multisig script is unchanged. */
  async rename(userId: string, bucketId: string, newLabel: string) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    const trimmed = (newLabel ?? '').trim();
    if (trimmed.length < 2 || trimmed.length > MAX_LABEL_LEN) {
      throw new BadRequestException(`label must be 2–${MAX_LABEL_LEN} characters`);
    }
    const bucket = await this.prisma.treasuryBucket.findUnique({ where: { id: bucketId } });
    if (!bucket) throw new NotFoundException('bucket not found');
    if (bucket.label === trimmed) return bucket;
    // Reject duplicate labels under the same multisig config (case-sensitive
    // by Prisma default — fine, the form trims and shows the exact label).
    const dup = await this.prisma.treasuryBucket.findFirst({ where: { configId: bucket.configId, label: trimmed, NOT: { id: bucketId } } });
    if (dup) throw new ConflictException('a bucket with that label already exists');
    return this.prisma.treasuryBucket.update({ where: { id: bucketId }, data: { label: trimmed } });
  }

  /** §15.6 — set or unset a bucket as the default for an operation kind.
   *  Setting true on bucket B for op X auto-clears the same flag on every
   *  OTHER bucket of the same multisig config (partial unique enforces this
   *  at the DB layer too — we clear first to avoid the conflict).
   *
   *  Operations:
   *   • FUNDING / REWARDS / OPERATIONS — outbound (platform spends from here)
   *   • SUBMISSION_FEES / PLEDGE       — inbound (platform tells submitters
   *     to pay here)
   */
  async setDefault(userId: string, bucketId: string, operation: BucketOperation, value: boolean) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    const bucket = await this.prisma.treasuryBucket.findUnique({ where: { id: bucketId } });
    if (!bucket) throw new NotFoundException('bucket not found');
    const column = OPERATION_COLUMN[operation];
    await this.prisma.$transaction(async (tx) => {
      if (value) {
        await tx.treasuryBucket.updateMany({
          where: { configId: bucket.configId, NOT: { id: bucketId } },
          data: { [column]: false },
        });
      }
      await tx.treasuryBucket.update({ where: { id: bucketId }, data: { [column]: value } });
    });
    return { ok: true };
  }

  /** §15.6 — look up the default bucket for an operation. Falls back to the
   *  primary when no explicit default is set, so flows always have a target.
   *  Returns null only when no multisig exists. */
  async defaultBucketFor(operation: BucketOperation) {
    const active = await this.prisma.multisigConfig.findFirst({
      where: { replacedAt: null },
      orderBy: { assembledAt: 'desc' },
    });
    if (!active) return null;
    // Auto-create the primary so we always have a fallback.
    await this.ensurePrimary(active.id, active.bech32Address, active.scriptJson as object, active.scriptHash);
    const column = OPERATION_COLUMN[operation];
    const tagged = await this.prisma.treasuryBucket.findFirst({
      where: { configId: active.id, [column]: true },
    });
    if (tagged) return tagged;
    return this.prisma.treasuryBucket.findFirst({ where: { configId: active.id, isPrimary: true } });
  }

  /** §15.5 — delete a bucket. Refused for the primary (it's the multisig
   *  itself) and for any bucket with funds on-chain (the address would be
   *  orphaned — drain it first via the Send-from-treasury flow). */
  async remove(userId: string, bucketId: string) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    const bucket = await this.prisma.treasuryBucket.findUnique({ where: { id: bucketId } });
    if (!bucket) throw new NotFoundException('bucket not found');
    if (bucket.isPrimary) throw new ConflictException('the primary bucket cannot be deleted');
    // Live balance check — refuse if funds remain at the bucket address.
    const balMap = await this.cardano.addressBalance([bucket.bech32Address]).catch(() => new Map<string, bigint>());
    const lovelace = balMap.get(bucket.bech32Address) ?? 0n;
    if (lovelace > 0n) {
      const ada = Number(lovelace) / LOVELACE;
      throw new ConflictException(
        `bucket still holds ${ada.toLocaleString()} ₳ on-chain — drain it via Send from treasury first, then delete.`,
      );
    }
    // Refuse if there are referencing actions still pending. Confirmed/failed
    // actions can stay (history), but the FK is on a nullable column so we
    // null them out for cleanliness.
    const pending = await this.prisma.multisigAction.count({
      where: { sourceBucketId: bucketId, status: { in: ['PENDING_SIGS', 'READY', 'BROADCASTED'] } },
    });
    if (pending > 0) {
      throw new ConflictException('there are pending multisig actions using this bucket — cancel or wait for them to confirm first.');
    }
    await this.prisma.multisigAction.updateMany({
      where: { sourceBucketId: bucketId },
      data: { sourceBucketId: null },
    });
    await this.prisma.treasuryBucket.delete({ where: { id: bucketId } });
    return { ok: true };
  }

  /** Convenience: the active multisig's primary bucket id (auto-creating it). */
  async primaryBucketId(): Promise<string | null> {
    const active = await this.prisma.multisigConfig.findFirst({
      where: { replacedAt: null },
      orderBy: { assembledAt: 'desc' },
    });
    if (!active) return null;
    const p = await this.ensurePrimary(active.id, active.bech32Address, active.scriptJson as object, active.scriptHash);
    return p.id;
  }

  private async isBoard(userId: string): Promise<boolean> {
    const u = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { drepKeyHash: true } });
    if (!u?.drepKeyHash) return false;
    const seat = await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: u.drepKeyHash } });
    return !!seat;
  }

  private async ensurePrimary(configId: string, bech32Address: string, scriptJson: object, scriptHash: string) {
    const existing = await this.prisma.treasuryBucket.findFirst({ where: { configId, isPrimary: true } });
    if (existing) return existing;
    return this.prisma.treasuryBucket.create({
      data: { configId, label: '', scriptJson, scriptHash, bech32Address, isPrimary: true },
    });
  }

  /** Build the wrapped script for a labeled bucket and derive its address. */
  private buildLabeledScript(originalScriptJson: object, label: string) {
    const original = this.scriptJsonToCSL(originalScriptJson);

    // 28-byte deterministic label hash (sha256, truncated). Doesn't have to
    // be cryptographically tied to ed25519 because this "key" never signs —
    // the inner clause is 0-of-1 (always satisfied). The only requirement
    // is that distinct labels produce distinct hashes.
    const labelBytes = Buffer.from(label, 'utf8');
    const labelKeyHashBytes = createHash('sha256').update(labelBytes).digest().subarray(0, 28);
    const labelKeyHash = CSL.Ed25519KeyHash.from_bytes(labelKeyHashBytes);

    // Inner: ScriptNOfK(0, [labelKeyHash]) — always satisfied.
    const inner = CSL.NativeScripts.new();
    inner.add(CSL.NativeScript.new_script_pubkey(CSL.ScriptPubkey.new(labelKeyHash)));
    const labelClause = CSL.NativeScript.new_script_n_of_k(CSL.ScriptNOfK.new(0, inner));

    // Outer: ScriptAll [original, labelClause].
    const outerArr = CSL.NativeScripts.new();
    outerArr.add(original);
    outerArr.add(labelClause);
    const top = CSL.NativeScript.new_script_all(CSL.ScriptAll.new(outerArr));

    const scriptHashObj = top.hash();
    const scriptHash = scriptHashObj.to_hex();
    const bech32Address = CSL.EnterpriseAddress.new(
      this.networkId,
      CSL.Credential.from_scripthash(scriptHashObj),
    ).to_address().to_bech32();
    const scriptJson = {
      type: 'all' as const,
      scripts: [
        originalScriptJson as { type: string; scripts: { type: string; keyHash: string }[] },
        {
          type: 'atLeast' as const,
          required: 0,
          scripts: [{ type: 'sig' as const, keyHash: Buffer.from(labelKeyHashBytes).toString('hex') }],
        },
      ],
    };
    return { scriptJson, scriptHash, bech32Address };
  }

  /** Reconstruct a CSL.NativeScript from our stored JSON shape. */
  private scriptJsonToCSL(json: object): CSL.NativeScript {
    const node = json as { type: string; required?: number; scripts?: object[] };
    if (node.type === 'sig') {
      const kh = (json as { keyHash: string }).keyHash;
      return CSL.NativeScript.new_script_pubkey(CSL.ScriptPubkey.new(CSL.Ed25519KeyHash.from_hex(kh)));
    }
    if (node.type === 'all') {
      const arr = CSL.NativeScripts.new();
      for (const child of node.scripts ?? []) arr.add(this.scriptJsonToCSL(child));
      return CSL.NativeScript.new_script_all(CSL.ScriptAll.new(arr));
    }
    if (node.type === 'any') {
      const arr = CSL.NativeScripts.new();
      for (const child of node.scripts ?? []) arr.add(this.scriptJsonToCSL(child));
      return CSL.NativeScript.new_script_any(CSL.ScriptAny.new(arr));
    }
    if (node.type === 'atLeast') {
      const arr = CSL.NativeScripts.new();
      for (const child of node.scripts ?? []) arr.add(this.scriptJsonToCSL(child));
      return CSL.NativeScript.new_script_n_of_k(CSL.ScriptNOfK.new(node.required ?? 0, arr));
    }
    throw new Error(`unknown native-script node type: ${node.type}`);
  }
}
