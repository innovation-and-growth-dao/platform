import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RoundsService } from './rounds.service';

const TICK_MS = 60_000; // check once a minute — stage windows are coarse (hours/days)

/**
 * §8 — auto-advances round stages whose board-confirmed, auto-start window is due.
 * Dependency-free (a plain interval started on module init) to avoid adding a
 * scheduling package; manual launches go through RoundsService directly.
 */
@Injectable()
export class RoundsSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoundsSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly rounds: RoundsService) {}

  onModuleInit() {
    // Disable the auto-stage ticker in tests/CLI to keep service runs deterministic.
    if (process.env.ROUNDS_SCHEDULER_DISABLED === '1') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    if (this.timer.unref) this.timer.unref(); // don't keep the process alive
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const advanced = await this.rounds.advanceDueStages();
      if (advanced.length) this.logger.log(`auto-advanced ${advanced.length} round stage(s): ${advanced.join(', ')}`);
    } catch (e) {
      this.logger.warn(`stage scheduler tick failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
