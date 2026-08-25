import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

export interface RateLimitOutcome {
  allowed: boolean;
  retryAfterSec: number;
}

// SEC-05 — atomic fixed-window counter in Redis, so the budget is shared across every API
// instance rather than per-process. INCR + first-hit EXPIRE run in one server-side Lua step so
// concurrent requests can't race past the limit or leak a key without a TTL.
const HIT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('TTL', KEYS[1])}
`;

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Count one hit against `key`. Throws if Redis is unreachable (caller decides open/closed). */
  async hit(key: string, points: number, durationSec: number): Promise<RateLimitOutcome> {
    const [count, ttl] = (await this.redis.client.eval(HIT, 1, key, String(durationSec))) as [number, number];
    return { allowed: count <= points, retryAfterSec: ttl > 0 ? ttl : durationSec };
  }
}
