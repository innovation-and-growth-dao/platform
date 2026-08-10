/**
 * String-literal domains for columns the design (§24) stores as TEXT.
 * Kept as `as const` objects so values are reusable at runtime (seeds, guards)
 * and as union types for compile-time safety. The DB columns stay plain TEXT.
 */

/** §2 Roles. A user may hold several at once. */
export const Role = {
  VIEWER: 'VIEWER',
  SUBMITTER: 'SUBMITTER',
  DREP: 'DREP',
  DAO_MEMBER: 'DAO_MEMBER', // admitted into the DAO (board member, or DRep admitted via 3-of-5 board vote)
  FILTER_REVIEWER: 'FILTER_REVIEWER',
  MILESTONE_REVIEWER: 'MILESTONE_REVIEWER',
  EXPERT: 'EXPERT',
  BOARD: 'BOARD',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN', // §18 — operational, not governance; separate identity/session
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** §25.13 admin account status */
export const AdminStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  REMOVED: 'REMOVED',
} as const;
export type AdminStatus = (typeof AdminStatus)[keyof typeof AdminStatus];

/** §3.1/§3.2 */
export const ProposalType = {
  FUNDING: 'FUNDING',
  INTERNAL: 'INTERNAL',
} as const;
export type ProposalType = (typeof ProposalType)[keyof typeof ProposalType];

/** §3.3 */
export const ProposalStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
} as const;
export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

/** §3.4 stage */
export const ProposalStage = {
  FILTERING: 'FILTERING',
  DEBATE_VOTE: 'DEBATE_VOTE',
  FUNDING: 'FUNDING',
  VOTING: 'VOTING', // internal proposals
} as const;
export type ProposalStage = (typeof ProposalStage)[keyof typeof ProposalStage];

/** §4.1 voting systems */
export const VotingType = {
  ONE_PERSON_ONE_VOTE: 'ONE_PERSON_ONE_VOTE',
  BALANCED: 'BALANCED',
  ONCHAIN: 'ONCHAIN',
} as const;
export type VotingType = (typeof VotingType)[keyof typeof VotingType];

/** §3.4 / §8.2 */
export const VoteChoice = {
  YES: 'YES',
  NO: 'NO',
  ABSTAIN: 'ABSTAIN',
} as const;
export type VoteChoice = (typeof VoteChoice)[keyof typeof VoteChoice];

/** Discriminates which phase a vote belongs to (one proposal spans several). */
export const VotePhase = {
  FILTERING: 'FILTERING',
  DEBATE_VOTE: 'DEBATE_VOTE',
  MILESTONE: 'MILESTONE',
  QUICK_POLL: 'QUICK_POLL',
  INTERNAL: 'INTERNAL',
} as const;
export type VotePhase = (typeof VotePhase)[keyof typeof VotePhase];

/** §3.4 internal-specific */
export const InternalType = {
  INSTRUCTIVE: 'INSTRUCTIVE',
  INFORMATIVE: 'INFORMATIVE',
  POLL: 'POLL',
  SPENDING: 'SPENDING', // §10.5 — approved → an OPS multisig action the board signs
} as const;
export type InternalType = (typeof InternalType)[keyof typeof InternalType];

export const VotersScope = {
  DREPS_ONLY: 'DREPS_ONLY',
  BOARD_ONLY: 'BOARD_ONLY',
  BOTH: 'BOTH',
} as const;
export type VotersScope = (typeof VotersScope)[keyof typeof VotersScope];

export const ThresholdKind = {
  DEFAULT: 'DEFAULT',
  IMPORTANT: 'IMPORTANT',
} as const;
export type ThresholdKind = (typeof ThresholdKind)[keyof typeof ThresholdKind];

/** §5.3 categories */
export const CategoryType = {
  GRANT: 'GRANT',
  RFP: 'RFP',
} as const;
export type CategoryType = (typeof CategoryType)[keyof typeof CategoryType];

/** §16.3 pledge return */
export const PledgeReturnMethod = {
  LAST_MILESTONE: 'LAST_MILESTONE',
  PER_MILESTONE: 'PER_MILESTONE',
} as const;
export type PledgeReturnMethod = (typeof PledgeReturnMethod)[keyof typeof PledgeReturnMethod];

/**
 * §24.3 round status. The §8 "Debate & Vote" phase is split into two consecutive
 * sub-stages — DEBATE (DReps comment + submitter revises) and VOTE (ballots open).
 * DV is retained as a deprecated alias treated as VOTE for any pre-split rows.
 */
export const RoundStatus = {
  PREPARATION: 'PREPARATION', // §6 board configures the round
  SUBMISSION: 'SUBMISSION', // submission window open — proposals accepted (§3/§19)
  FILTERING: 'FILTERING',
  DEBATE: 'DEBATE', // §8.1 — DReps discuss; submitter may still revise; no voting yet
  VOTE: 'VOTE',     // §8.2 — ballots open; proposal frozen; tally crystallizes when VOTE ends
  DV: 'DV',         // deprecated alias for VOTE; kept for any pre-split rows
  TALLY: 'TALLY',   // §9 — results published (approved/rejected/budget-cut); only tie-break quick polls run; funding mechanics not yet active
  FUNDING: 'FUNDING',
  CLOSED: 'CLOSED',
} as const;
export type RoundStatus = (typeof RoundStatus)[keyof typeof RoundStatus];

/** §24.1 drep status (REJECTED added for applications declined by the board, §14.2). */
export const DRepStatus = {
  PENDING_ADMISSION: 'PENDING_ADMISSION',
  ADMITTED: 'ADMITTED',
  REJECTED: 'REJECTED',
  REMOVED: 'REMOVED',
} as const;
export type DRepStatus = (typeof DRepStatus)[keyof typeof DRepStatus];

/** §24.4 milestone status */
export const MilestoneStatus = {
  NOT_STARTED: 'NOT_STARTED',
  POA_SUBMITTED: 'POA_SUBMITTED',
  IN_REVIEW: 'IN_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type MilestoneStatus = (typeof MilestoneStatus)[keyof typeof MilestoneStatus];

/** §24.6 quick poll status */
export const QuickPollStatus = {
  PENDING_BOARD: 'PENDING_BOARD',
  ACTIVE: 'ACTIVE',
  RESOLVED: 'RESOLVED',
  FAILED: 'FAILED',
} as const;
export type QuickPollStatus = (typeof QuickPollStatus)[keyof typeof QuickPollStatus];

/** §24.8 reward calculation kind */
export const RewardKind = {
  FILTER: 'FILTER',
  DV_FIXED: 'DV_FIXED',
  DV_BONUS: 'DV_BONUS',
  MILESTONE: 'MILESTONE',
} as const;
export type RewardKind = (typeof RewardKind)[keyof typeof RewardKind];

/** §24.9 multisig action kind / status */
export const MultisigActionKind = {
  REWARD_PAYOUT: 'REWARD_PAYOUT',
  PROJECT_FUNDING: 'PROJECT_FUNDING',
  PLEDGE_RETURN: 'PLEDGE_RETURN',
  OPS: 'OPS',
  LEFTOVER_RETURN: 'LEFTOVER_RETURN',
} as const;
export type MultisigActionKind = (typeof MultisigActionKind)[keyof typeof MultisigActionKind];

export const MultisigActionStatus = {
  PENDING_SIGS: 'PENDING_SIGS',
  BROADCASTED: 'BROADCASTED',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
} as const;
export type MultisigActionStatus = (typeof MultisigActionStatus)[keyof typeof MultisigActionStatus];

/** §23.1 anchor kinds */
export const AnchorKind = {
  PROPOSAL_READY: 'proposal_ready',
  VOTE_TALLY_DAILY: 'vote_tally_daily',
  VOTE_TALLY_FINAL: 'vote_tally_final',
  POWER_SNAPSHOT: 'power_snapshot',
  MERIT_DAILY: 'merit_daily',
  CONFIG_CHANGE: 'config_change',
} as const;
export type AnchorKind = (typeof AnchorKind)[keyof typeof AnchorKind];

/** §22 / §28.1-Q3 supported networks */
export const CardanoNetwork = {
  Preprod: 'Preprod',
  Preview: 'Preview',
  Mainnet: 'Mainnet',
} as const;
export type CardanoNetwork = (typeof CardanoNetwork)[keyof typeof CardanoNetwork];
