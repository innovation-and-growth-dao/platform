import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// §2/§14 — an ADA holder applies to become an Expert; the board then approves.
export class ExpertApplicationDto {
  @IsString() @IsNotEmpty() @MaxLength(100) displayName!: string;
  @IsOptional() @IsString() @MaxLength(20000) bio?: string;
  @IsOptional() @IsString() @MaxLength(20000) conflictOfInterest?: string;
  @IsOptional() @IsString() @MaxLength(20000) motivation?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(120) telegram?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(500, { each: true }) socialLinks?: string[];
  @IsOptional() @IsString() @MaxLength(700000) logoDataUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[];
}

export class DrepApplicationDto {
  // The on-chain DRep ID is NOT accepted from the client: it's derived from the
  // wallet's CIP-95 DRep key (captured at login) and verified on-chain.
  @IsOptional() @IsString() @MaxLength(100) displayName?: string;
  @IsOptional() @IsString() @MaxLength(5000) bio?: string;
  // Optional profile photo (data URL). Empty string = none → the display falls
  // back to the on-chain CIP-119 image, then a placeholder. Never required.
  // ~700k chars ≈ 512 KB binary — the client resizes uploads to a 640px standard.
  @IsOptional() @IsString() @MaxLength(700_000) photo?: string;
  @IsOptional() @IsObject() socials?: Record<string, unknown>;
  @IsOptional() @IsObject() contact?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[];
  @IsOptional() @IsBoolean() kycOptin?: boolean;
  // §2.1 — conflict-of-interest disclosure + informative no-self-vote pledge.
  @IsOptional() @IsString() @MaxLength(20000) conflictOfInterest?: string;
  @IsOptional() @IsBoolean() noSelfVotePledge?: boolean;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsBoolean() callsOptin?: boolean;
  @IsOptional() @IsBoolean() admissionCallOptin?: boolean;
  // §2 — cross-wallet link to a submitter profile the applicant declares as the same entity
  // (empty string = no link). Self-declared; can be set at join and edited later.
  @IsOptional() @IsString() @MaxLength(64) linkedSubmitterUserId?: string;
}

export class UpdateDrepDto {
  @IsOptional() @IsString() @MaxLength(100) displayName?: string;
  @IsOptional() @IsString() @MaxLength(5000) bio?: string;
  // Profile photo as a data URL ("data:image/webp;base64,…"). Capped at ~700k chars
  // ≈ 512 KB binary — a 640px standard avatar (client-resized), small enough for Postgres.
  // Empty string clears the photo (falls back to the on-chain CIP-119 image).
  @IsOptional() @IsString() @MaxLength(700_000) photo?: string;
  @IsOptional() @IsObject() socials?: Record<string, unknown>;
  @IsOptional() @IsObject() contact?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[];
  @IsOptional() @IsBoolean() kycOptin?: boolean;
  // §2.1 — conflict-of-interest disclosure + informative no-self-vote pledge.
  @IsOptional() @IsString() @MaxLength(20000) conflictOfInterest?: string;
  @IsOptional() @IsBoolean() noSelfVotePledge?: boolean;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsBoolean() callsOptin?: boolean;
  @IsOptional() @IsBoolean() admissionCallOptin?: boolean;
  // §8.2 — board-member self-toggle for "I'll vote on funding proposals".
  // Default true. Toggling off mid-VOTE zeroes the member's weight at the
  // next tally read (their snapshot entry is skipped — no snapshot mutation).
  @IsOptional() @IsBoolean() votesOnFundingProposals?: boolean;
  // §2 — cross-wallet link: the account id (SubmitterApplication.userId) of the submitter profile
  // this DAO member declares as the same entity (empty string clears the link). Self-declared.
  @IsOptional() @IsString() @MaxLength(64) linkedSubmitterUserId?: string;
}

/** §2 — board override of a DAO-member↔submitter link (set or clear). */
export class SetMemberLinkDto {
  @IsOptional() @IsString() @MaxLength(64) linkedSubmitterUserId?: string | null;
}

export class AdmissionVoteDto {
  @IsIn(['YES', 'NO'])
  choice!: 'YES' | 'NO';

  /** Written rationale — required for BOTH YES and NO (board accountability). */
  @IsString() @IsNotEmpty() @MaxLength(2000) feedback!: string;

  /** §C — CIP-30 signData over the canonical vote message (free, no tx). Optional. */
  @IsOptional() @IsString() @MaxLength(8000) signature?: string;
  @IsOptional() @IsString() @MaxLength(8000) signingKey?: string;
  @IsOptional() @IsString() @MaxLength(40) ts?: string;
}

// §14.4 — board proposes / votes to remove a DAO member.
export class ProposeRemovalDto {
  @IsString() @IsNotEmpty() @MaxLength(100) targetDrepId!: string;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class RemovalVoteDto {
  @IsIn(['YES', 'NO'])
  choice!: 'YES' | 'NO';

  @IsString() @IsNotEmpty() @MaxLength(2000) rationale!: string;
}
