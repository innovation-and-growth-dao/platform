import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MilestoneInput {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) description!: string;
  @IsOptional() @IsString() @MaxLength(5000) acceptanceCriteria?: string;
  @IsInt() @Min(0) amountAda!: number; // ADA
  @IsOptional() @IsInt() @Min(0) deadlineDays?: number;
}

export class CreateProposalDto {
  @IsUUID() roundId!: string;
  @IsUUID() categoryId!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(50000) contentMd!: string;
  @IsBoolean() isCommercial!: boolean;
  @IsInt() @Min(1) requestedAmountAda!: number; // ADA
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[];
  @IsOptional() @IsString() @MaxLength(20000) costBreakdownMd?: string;
  @IsOptional() @IsString() @MaxLength(20000) teamInfoMd?: string; // §3.4
  @IsOptional() @IsString() @MaxLength(20000) revenueSharingMd?: string; // §3.4 (commercial)
  @IsOptional() @IsString() @MaxLength(20000) ecosystemImpactMd?: string; // §3.4
  @IsOptional() @IsString() @MaxLength(20000) successMetricsMd?: string; // §3.4
  @IsOptional() @IsString() @MaxLength(200) payoutAddress?: string; // Cardano address for refunds / budget payout
  @IsOptional() @IsString() @MaxLength(120) submissionFeeTxHash?: string; // §12 — savable with the draft
  // §3 — optional refundable pledge. Only meaningful when the round's
  // pledgeThresholdAda > 0; when promised the amount must be ≥ threshold and a
  // return-method description is required. Sent on-chain AFTER approval.
  @IsOptional() @IsInt() @Min(0) pledgeAmountAda?: number;
  @IsOptional() @IsString() @MaxLength(5000) pledgeReturnMethod?: string;
  // §3.4 — revenue-sharing gate: when true, the team is promising a one-off
  // action (e.g. 10% of token supply to the Treasury) that the board must
  // verify before milestone work begins. Details live in `revenueSharingMd`.
  @IsOptional() @IsBoolean() revenueSharingRequired?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MilestoneInput)
  milestones!: MilestoneInput[];
}

export class UpdateProposalDto {
  @IsOptional() @IsUUID() categoryId?: string; // §5.2 — re-categorise a draft within its round
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(50000) contentMd?: string;
  @IsOptional() @IsBoolean() isCommercial?: boolean;
  @IsOptional() @IsInt() @Min(1) requestedAmountAda?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[];
  @IsOptional() @IsString() @MaxLength(20000) costBreakdownMd?: string;
  @IsOptional() @IsString() @MaxLength(20000) teamInfoMd?: string;
  @IsOptional() @IsString() @MaxLength(20000) revenueSharingMd?: string;
  @IsOptional() @IsString() @MaxLength(20000) ecosystemImpactMd?: string;
  @IsOptional() @IsString() @MaxLength(20000) successMetricsMd?: string;
  @IsOptional() @IsString() @MaxLength(200) payoutAddress?: string;
  @IsOptional() @IsString() @MaxLength(120) submissionFeeTxHash?: string;
  @IsOptional() @IsInt() @Min(0) pledgeAmountAda?: number;
  @IsOptional() @IsString() @MaxLength(5000) pledgeReturnMethod?: string;
  @IsOptional() @IsBoolean() revenueSharingRequired?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MilestoneInput)
  milestones?: MilestoneInput[];
}

/** Team pastes the on-chain pledge payment tx hash (in FUNDING, after approval). */
export class PledgeTxHashDto {
  @IsString() @IsNotEmpty() @MaxLength(120) txHash!: string;
}

/** Board confirms (or rejects) the on-chain pledge payment, like the fee review. */
export class ReviewPledgeDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsOptional() @IsString() @MaxLength(5000) feedback?: string;
}

export class SubmitProposalDto {
  // Optional: when the round's fee for this proposal type is 0%, no tx is needed.
  @IsOptional() @IsString() @MaxLength(120) submissionFeeTxHash?: string;
}

export class ReviewFeeDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  // Shown to the submitter in the red FEEDBACK box — required when rejecting.
  @IsOptional() @IsString() @MaxLength(5000) feedback?: string;
}

// §12 — change an ACTIVE proposal's budget; the fee delta becomes a top-up/refund task.
export class BudgetChangeDto {
  @IsInt() @Min(1) requestedAmountAda!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MilestoneInput)
  milestones!: MilestoneInput[];
  // Optional context the submitter sends to the board with the request.
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class BudgetChangeDecisionDto {
  @IsOptional() @IsString() @MaxLength(2000) feedback?: string;
}

export class SettlePaymentDto {
  // Optional: a REFUND records the board's tx hash here; a TOPUP confirm uses the submitter's
  // already-submitted hash, so the board sends none.
  @IsOptional() @IsString() @MaxLength(120) txHash?: string;
}

export class FeeTopUpDto {
  @IsString() @IsNotEmpty() @MaxLength(120) txHash!: string;
}

export class FilterVoteDto {
  @IsIn(['YES', 'NO', 'ABSTAIN']) choice!: 'YES' | 'NO' | 'ABSTAIN';
  @IsOptional() @IsString() @MaxLength(5000) rationale?: string;
}

export class DvVoteDto {
  @IsIn(['YES', 'NO', 'ABSTAIN']) choice!: 'YES' | 'NO' | 'ABSTAIN';
  // §8.2 — rationale mandatory (min 200 chars) for any cast D&V vote.
  @IsString() @MinLength(200) @MaxLength(10000) rationale!: string;
}
