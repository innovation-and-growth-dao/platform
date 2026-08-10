import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Shared Redis connection (auth nonces + session denylist now; BullMQ later).
 * ioredis auto-connects and retries in the background; we swallow 'error'
 * events so a missing Redis never crashes the process at boot. The health
 * check uses a timed ping so it can report 'down' without hanging.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    this.client.on('error', () => undefined);
  }

  async ping(): Promise<boolean> {
    try {
      const res = await Promise.race([
        this.client.ping(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
      ]);
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
