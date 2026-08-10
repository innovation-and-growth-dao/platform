/**
 * §14 — does a registered DRep with a complete profile join immediately, or wait for the
 * board's admission vote?
 *
 * Shared by the join flow and the eligibility check the Join-DAO button reads, so the promise
 * shown in the UI and the status actually written can never drift apart.
 *
 *  - Membership open (DREP_OPEN_ADMISSION, the default) → admitted immediately.
 *  - No board seated → admitted immediately regardless: there is nobody to run the vote, and
 *    DReps must be able to join and vote in the proposal that elects the first board.
 *  - Otherwise → PENDING_ADMISSION, awaiting the board.
 */
export function isAutoAdmitted(openAdmission: boolean, boardSeats: number): boolean {
  return openAdmission || boardSeats === 0;
}
