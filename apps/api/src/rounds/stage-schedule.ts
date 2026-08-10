/**
 * §8 — the single condition the scheduler uses to auto-advance a round into its NEXT stage: the
 * next stage must be board-CONFIRMED, flagged AUTO-START, and its planned start must have arrived.
 * Pure (no Prisma) so the trigger is unit-testable and can't silently drift.
 */
export function isStageDueToAutoStart(
  stage: { autoStart: boolean; confirmedAt: Date | null; startsAt: Date },
  now: Date,
): boolean {
  return stage.autoStart && stage.confirmedAt != null && stage.startsAt.getTime() <= now.getTime();
}
