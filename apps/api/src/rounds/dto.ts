import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CategoryType } from '@drep-dao/shared';

/**
 * §6/§12 — per-round settings (omit to use the ROUND_SETTING_DEFAULTS value). The
 * approval-vote counts must not exceed their reviewer counts; that cross-field rule
 * is enforced in RoundsService (clearer errors than a declarative validator).
 */
export class RoundSettingsInput {
  @IsOptional() @IsInt() @Min(1) filterReviewerCount?: number;
  @IsOptional() @IsInt() @Min(1) filterApprovalVotes?: number;
  @IsOptional() @IsInt() @Min(1) milestoneReviewerCount?: number;
  @IsOptional() @IsInt() @Min(1) milestoneApprovalVotes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) dvApprovalThresholdPct?: number;
  // §12.2 — reward pool splits: experts' direct cut (subtracted first), then of the
  // DReps' pool the D&V share (rest → milestone), and within D&V the fixed share.
  @IsOptional() @IsInt() @Min(0) @Max(100) rewardExpertSharePct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) rewardDvSharePct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) rewardFixedPct?: number;
  // §12 — submission fees.
  @IsOptional() @IsInt() @Min(0) @Max(100) feeCommercialPct?: number;
  @IsOptional() @IsInt() @Min(0) feeCommercialCapAda?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) feeOssPct?: number;
  @IsOptional() @IsInt() @Min(0) feeOssCapAda?: number;
  @IsOptional() @IsInt() @Min(0) feeCapPerRoundAda?: number;
  // §9 — quick poll.
  @IsOptional() @IsInt() @Min(0) @Max(100) quickPollParticipationPct?: number;
  @IsOptional() @IsInt() @Min(1) quickPollDurationHours?: number;
  @IsOptional() @IsInt() @Min(0) quickPollMaxExtensions?: number;
  // §11 — milestone timing.
  @IsOptional() @IsInt() @Min(0) milestoneNotificationDaysBeforeEnd?: number;
  @IsOptional() @IsInt() @Min(0) milestoneAutoExtensionDays?: number;
  @IsOptional() @IsInt() @Min(0) milestoneCheckPeriodDays?: number;
  @IsOptional() @IsInt() @Min(0) milestoneBoardExtraExtensionDays?: number;
  @IsOptional() @IsInt() @Min(0) boardPayoutDeadlineDays?: number;
  // §3 — proposer pledge.
  @IsOptional() @IsInt() @Min(0) pledgeThresholdAda?: number;
  @IsOptional() @IsInt() @Min(0) pledgeGraceDays?: number;
  // §7.4 — filter-rejected proposals: how many revise + resubmit cycles allowed.
  @IsOptional() @IsInt() @Min(0) filterResubmissionsAllowed?: number;
  // §12 — in-filter budget changes: how many times the submitter may change the
  // budget while the round is in FILTERING (each clears filtering votes).
  @IsOptional() @IsInt() @Min(0) filterBudgetChangesAllowed?: number;
  // §3 — minimum word count enforced on every mandatory text field at submit
  // and on post-submission edits. 0 disables the check (test mode).
  @IsOptional() @IsInt() @Min(0) mandatoryWords?: number;
  // §3 — maximum word count per mandatory field. 0 disables the upper bound.
  @IsOptional() @IsInt() @Min(0) mandatoryWordsMax?: number;
  // §3 — minimum number of characters a proposal title must have. 0 disables.
  @IsOptional() @IsInt() @Min(0) minimumTitleLen?: number;
  // §3 — minimum word count for short text fields (milestone titles). 0 disables.
  @IsOptional() @IsInt() @Min(0) minimumMilestoneTitleLen?: number;
  // §12 — budget-change policy (YES/NO as 1/0). See ROUND_SETTING_META for behavior.
  @IsOptional() @IsInt() @Min(0) @Max(1) ignoreBudgetChange?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1) requireFeeTopUp?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1) requireFeeReturn?: number;
}

// MVP schedule uses coarse operational windows rather than the 9 fine-grained
// sub-periods in §6. Categories may be GRANT or RFP (§5.2). §8 — what was a
// single 'debate_vote' window is split into 'debate' (comments + revisions, no
// voting) and 'vote' (ballots open, proposal frozen). 'tally' sits between 'vote'
// and 'funding' (voting closed, results published, tie-break quick polls only).
// 'debate_vote' is kept as an accepted alias for any pre-split rows; new schedules
// use the split.
export const ROUND_STAGE_KEYS = ['submission', 'filtering', 'debate', 'vote', 'tally', 'funding'] as const;
export const ROUND_STAGE_KEYS_LEGACY = [...ROUND_STAGE_KEYS, 'debate_vote'] as const;
const CATEGORY_TYPES = Object.values(CategoryType) as string[]; // ['GRANT','RFP']

export class CategoryInput {
  @IsOptional() @IsUUID() id?: string; // present when editing an existing category (update in place)
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @IsIn(CATEGORY_TYPES) type?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) conditions?: string;
  @IsInt() @Min(0) allocatedAda!: number; // ADA
  @IsOptional() @IsInt() @Min(0) minAda?: number;
  @IsOptional() @IsInt() @Min(0) maxAda?: number;
}

/** §8 — board confirms entering the next stage: auto at the date, or manual launch. */
export class ConfirmStageDto {
  @IsBoolean() autoStart!: boolean;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
}

// The stage-key param for confirm/launch routes. Accepts the legacy
// debate_vote alias so existing UI calls don't break during rollout.
export const ROUND_STAGE_KEY_LEGACY = ROUND_STAGE_KEYS_LEGACY;

// §6 — board shortens or extends the currently-running stage's end. Start is
// frozen (the stage already started), and a new end can't fall behind "now".
export class UpdateCurrentStageDto {
  @IsDateString() endsAt!: string;
}

export class ScheduleInput {
  @IsIn(ROUND_STAGE_KEYS_LEGACY) stageKey!: (typeof ROUND_STAGE_KEYS_LEGACY)[number];
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
}

export class CreateRoundDto extends RoundSettingsInput {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsInt() @Min(0) budgetAda!: number; // ADA
  @IsInt() @Min(0) rewardsPoolAda!: number; // ADA
  @IsOptional() @IsString() @MaxLength(200) multisigAddress?: string;
  @IsOptional() @IsString() @MaxLength(120) intersectTxHash?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CategoryInput)
  categories!: CategoryInput[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleInput)
  schedule?: ScheduleInput[];

  /** Defaults to all admitted DReps if omitted. */
  @IsOptional() @IsArray() @IsString({ each: true }) eligibleDrepIds?: string[];
}

export class UpdateRoundDto extends RoundSettingsInput {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsInt() @Min(0) budgetAda?: number;
  @IsOptional() @IsInt() @Min(0) rewardsPoolAda?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CategoryInput)
  categories?: CategoryInput[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleInput)
  schedule?: ScheduleInput[];

  @IsOptional() @IsArray() @IsString({ each: true }) eligibleDrepIds?: string[];
}
