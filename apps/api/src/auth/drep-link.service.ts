import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drepKeyHashFromPubKeyHex, stakeAddrHexFromKeyHashHex } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { verifyDrepKeySignature } from './cip30';

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes to sign
const PURPOSE = 'drep-key-ownership';
const METHOD = 'cip95-signdata-v1';

interface StoredChallenge {
  challenge: string;
  drepKeyHex: string;
  claimedHash: string;
  exp: number;
}

/**
 * SEC-01 — prove control of a DRep governance key. A stake-key login authenticates the wallet;
 * this separate flow requires a signature made by the DRep signing key over a server challenge
 * bound to the user, the claimed DRep key, a nonce, the domain, a purpose, and an expiry. Only a
 * proven binding is trusted for board/DRep authorization (see BoardGuard when REQUIRE_PROVEN_DREP).
 */
@Injectable()
export class DrepLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** 1 = mainnet, 0 = preprod/testnet — must match the wallet's network for the address to line up. */
  private network(): number {
    return this.config.get<string>('CARDANO_NETWORK') === 'Mainnet' ? 1 : 0;
  }

  private domain(): string {
    return this.config.get<string>('PUBLIC_WEB_ORIGIN') ?? this.config.get<string>('NEXT_PUBLIC_API_URL') ?? 'drep-council';
  }

  private key(userId: string): string {
    return `drep:challenge:${userId}`;
  }

  /** Issue a fresh challenge the wallet must sign with its DRep key. */
  async issueChallenge(userId: string, stakeKeyHash: string, drepKeyHex: string) {
    let claimedHash: string;
    try {
      claimedHash = drepKeyHashFromPubKeyHex(drepKeyHex);
    } catch {
      throw new BadRequestException('drepKeyHex is not a valid CIP-95 DRep public key');
    }
    const nonce = randomBytes(16).toString('hex');
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + CHALLENGE_TTL_SECONDS;
    const challenge = [
      `DRep Council — prove DRep key ownership`,
      `domain: ${this.domain()}`,
      `purpose: ${PURPOSE}`,
      `user: ${userId}`,
      `stakeKeyHash: ${stakeKeyHash}`,
      `drepKeyHash: ${claimedHash}`,
      `nonce: ${nonce}`,
      `issuedAt: ${iat}`,
      `expiresAt: ${exp}`,
    ].join('\n');

    const stored: StoredChallenge = { challenge, drepKeyHex, claimedHash, exp };
    await this.redis.client.set(this.key(userId), JSON.stringify(stored), 'EX', CHALLENGE_TTL_SECONDS);

    // Return the address the wallet must sign over (built from the claimed DRep key hash) so the
    // frontend and backend agree byte-for-byte regardless of client-side address construction.
    return { challenge, addressHex: stakeAddrHexFromKeyHashHex(claimedHash, this.network()) };
  }

  /** Verify the signed challenge and, on success, record a proven binding. */
  async verifyChallenge(params: {
    userId: string;
    drepKeyHex: string;
    signature: string;
    key: string;
  }) {
    const raw = await this.redis.client.getdel(this.key(params.userId)); // one-time use
    if (!raw) throw new UnauthorizedException('no active DRep challenge — request a new one');
    const stored = JSON.parse(raw) as StoredChallenge;
    if (stored.drepKeyHex !== params.drepKeyHex) {
      throw new BadRequestException('drepKeyHex does not match the issued challenge');
    }
    if (Math.floor(Date.now() / 1000) > stored.exp) {
      throw new UnauthorizedException('DRep challenge expired — request a new one');
    }

    const provenHash = verifyDrepKeySignature(
      params.drepKeyHex,
      params.signature,
      params.key,
      stored.challenge,
      this.network(),
    );
    if (!provenHash || provenHash !== stored.claimedHash) {
      throw new UnauthorizedException('DRep key signature verification failed');
    }

    // Uniqueness: the key must not already be bound to a different user (the DB unique index is the
    // atomic backstop; this gives a clean error instead of a 500 on the race).
    const other = await this.prisma.appUser.findFirst({
      where: { drepKeyHash: provenHash, NOT: { id: params.userId } },
      select: { id: true },
    });
    if (other) throw new ConflictException('this DRep key is already linked to another account');

    const challengeHash = createHash('sha256').update(stored.challenge, 'utf8').digest('hex');
    try {
      await this.prisma.$transaction([
        this.prisma.drepKeyProof.create({
          data: {
            userId: params.userId,
            drepKeyHash: provenHash,
            challengeHash,
            signatureHex: params.signature,
            method: METHOD,
          },
        }),
        this.prisma.appUser.update({
          where: { id: params.userId },
          data: { drepKeyHash: provenHash, drepKeyProvenAt: new Date() },
        }),
      ]);
    } catch (e) {
      // Unique-index violation → the key was claimed concurrently.
      if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
        throw new ConflictException('this DRep key is already linked to another account');
      }
      throw e;
    }

    return { proven: true, drepKeyHash: provenHash };
  }
}

/** SEC-01 — when true, only a cryptographically proven DRep binding grants board/DRep authority. */
export function isProvenDrepRequired(config: ConfigService): boolean {
  return config.get<string>('REQUIRE_PROVEN_DREP') === 'true';
}
