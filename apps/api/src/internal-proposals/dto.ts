import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const INTERNAL_TYPES = ['INSTRUCTIVE', 'INFORMATIVE', 'POLL', 'SPENDING', 'RULE_APPROVAL', 'DECISION_APPROVAL'];
const SCOPES = ['DREPS_ONLY', 'BOARD_ONLY', 'BOTH'];
const THRESHOLDS = ['DEFAULT', 'IMPORTANT'];
const VOTING_TYPES = ['ONE_PERSON_ONE_VOTE', 'BALANCED', 'ONCHAIN'];

/** §10.1 — submit an internal proposal (goes straight to ACTIVE; voting opens immediately). */
export class CreateInternalProposalDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) contentMd!: string; // always present, even for polls

  @IsIn(INTERNAL_TYPES) internalType!: string;
  @IsIn(SCOPES) votersScope!: string;
  @IsIn(THRESHOLDS) thresholdKind!: string;
  @IsIn(VOTING_TYPES) votingType!: string;

  // The submitter picks a date; the platform derives the number of days. `votingPeriodDays`
  // is kept as an alternative/fallback (e.g. for API clients that prefer a duration).
  @IsOptional() @IsISO8601() votingEndAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) votingPeriodDays?: number;

  // PRIVATE → visible + votable to board members only (forces BOARD_ONLY scope).
  @IsOptional() @IsBoolean() isPrivate?: boolean;

  // POLL only: the choices + whether voters may pick more than one.
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMinSize(2) pollOptions?: string[];
  @IsOptional() @IsBoolean() pollMultiple?: boolean;

  // INSTRUCTIVE only: who is expected to act if approved + the target delivery date.
  @IsOptional() @IsArray() @IsString({ each: true }) actors?: string[];
  @IsOptional() @IsISO8601() deliveryDate?: string;

  // §10.5 SPENDING only: how much ADA leaves which treasury bucket to which address when
  // the proposal is approved (the board then signs the prepared multisig action).
  @IsOptional() @Min(1) spendingAmountAda?: number;
  @IsOptional() @IsString() spendingSourceBucketId?: string;
  @IsOptional() @IsString() @MaxLength(200) spendingDestAddress?: string;

  // §27 — rule-approval vote: the document under vote + whether this is a delete (vs approve) vote.
  @IsOptional() @IsString() ruleDocumentId?: string;
  @IsOptional() @IsBoolean() ruleDeleteRequested?: boolean;
  @IsOptional() @IsString() decisionId?: string;
  @IsOptional() @IsBoolean() decisionDeleteRequested?: boolean;

  // §14 board-member election: when true, the proposal is an INSTRUCTIVE internal proposal
  // whose `candidates` (exactly 5 admitted-DRep UUIDs) become the new board on approval +
  // deliveryDate. The submit method forces scope=BOTH / type=BALANCED / threshold=IMPORTANT.
  @IsOptional() @IsBoolean() isBoardElection?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) candidates?: string[];

  // When submitting from a saved draft, the draft row to remove once the live proposal is created.
  @IsOptional() @IsString() draftId?: string;
}

/**
 * §10 — save/update a draft internal proposal. Everything is optional and unvalidated for
 * completeness (a draft is work-in-progress) — full validation only happens on submit. The
 * draft is stored with status DRAFT, no voting snapshot, and is visible only to its author.
 */
export class SaveDraftDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(20000) contentMd?: string;
  @IsOptional() @IsIn(INTERNAL_TYPES) internalType?: string;
  @IsOptional() @IsIn(SCOPES) votersScope?: string;
  @IsOptional() @IsIn(THRESHOLDS) thresholdKind?: string;
  @IsOptional() @IsIn(VOTING_TYPES) votingType?: string;
  @IsOptional() @IsISO8601() votingEndAt?: string;
  @IsOptional() @IsBoolean() isPrivate?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) pollOptions?: string[];
  @IsOptional() @IsBoolean() pollMultiple?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) actors?: string[];
  @IsOptional() @IsISO8601() deliveryDate?: string;
  @IsOptional() @Min(0) spendingAmountAda?: number;
  @IsOptional() @IsString() spendingSourceBucketId?: string;
  @IsOptional() @IsString() @MaxLength(200) spendingDestAddress?: string;
}

/** Cast or change a vote. Threshold proposals use `choice`; polls use `options`. */
export class VoteInternalDto {
  @IsOptional() @IsIn(['YES', 'NO', 'ABSTAIN']) choice?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsString() @MaxLength(4000) rationale?: string;
}
