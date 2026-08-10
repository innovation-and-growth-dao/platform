import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions } from 'express';
import { RedisService } from '../redis/redis.service';
import { verifyCip30Signature } from './cip30';

export const SESSION_COOKIE = 'drep_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7-day rolling session (§22.1)

export interface SessionPayload {
  sub: string; // user id
  skh: string; // stake key hash
  jti: string; // token id (for denylist)
  iat?: number;
  exp?: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  verifyWalletSignature(params: {
    signature: string;
    key: string;
    message: string;
    stakeAddress: string;
  }): boolean {
    return verifyCip30Signature(params.signature, params.key, params.message, params.stakeAddress);
  }

  async issueSession(user: { id: string; stakeKeyHash: string }): Promise<string> {
    const payload: SessionPayload = {
      sub: user.id,
      skh: user.stakeKeyHash,
      jti: randomBytes(16).toString('hex'),
    };
    return this.jwt.signAsync(payload);
  }

  async verifyToken(token: string): Promise<SessionPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<SessionPayload>(token);
      if (await this.isRevoked(payload.jti)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  /** Add the token's jti to the denylist until its natural expiry (§22.1 logout). */
  async revoke(payload: SessionPayload): Promise<void> {
    const ttl = (payload.exp ?? 0) - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await this.redis.client.set(`auth:revoked:${payload.jti}`, '1', 'EX', ttl);
    }
  }

  private async isRevoked(jti: string): Promise<boolean> {
    return (await this.redis.client.exists(`auth:revoked:${jti}`)) === 1;
  }

  cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV') === 'production',
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: '/',
    };
  }
}
