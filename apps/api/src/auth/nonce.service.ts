import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { buildLoginMessage } from './login-message';

const NONCE_TTL_SECONDS = 300; // 5-minute TTL per §22.1

/**
 * Issues and consumes single-use login nonces. The full message to sign is
 * stored in Redis keyed by stake address; consume() is atomic (GETDEL) so a
 * nonce can be redeemed at most once.
 */
@Injectable()
export class NonceService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private key(stakeAddress: string): string {
    return `auth:nonce:${stakeAddress}`;
  }

  async issue(stakeAddress: string): Promise<{ message: string; expiresInSeconds: number }> {
    const nonce = randomBytes(32).toString('hex');
    const message = buildLoginMessage({
      domain: this.config.get<string>('LOGIN_DOMAIN') ?? 'DRep DAO',
      stakeAddress,
      nonce,
      issuedAt: new Date().toISOString(),
    });
    await this.redis.client.set(this.key(stakeAddress), message, 'EX', NONCE_TTL_SECONDS);
    return { message, expiresInSeconds: NONCE_TTL_SECONDS };
  }

  /** Returns the issued message and deletes it (single use), or null if absent/expired. */
  async consume(stakeAddress: string): Promise<string | null> {
    return this.redis.client.getdel(this.key(stakeAddress));
  }
}
