import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitterApplicationDto {
  @IsString() @IsNotEmpty() @MaxLength(120) displayName!: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) description!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(500, { each: true }) githubUrls?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(500, { each: true }) socialLinks?: string[];
  @IsOptional() @IsString() @MaxLength(700_000) logoDataUrl?: string; // base64 data URL (client-resized to 640px ≈ ≤512 KB)
  @IsString() @IsNotEmpty() @MaxLength(100) country!: string;
  // §2.1 — disclosure + contact.
  @IsString() @IsNotEmpty() @MaxLength(20000) conflictOfInterest!: string;
  @IsOptional() noSelfVotePledge?: boolean;
  @IsString() @IsNotEmpty() @MaxLength(200) telegram!: string;
  @IsString() @IsNotEmpty() @MaxLength(320) email!: string;
  // §2.1 — previous Cardano-ecosystem funding (optional, keep updated).
  @IsOptional() @IsString() @MaxLength(20000) previousFunding?: string;
  // §2.1 — consent that the profile is persisted by the platform (kept even after leaving).
  @IsOptional() agreePersist?: boolean;
  // §2 — cross-wallet link: the on-chain DRep id of the DAO-member profile this submitter
  // declares as the same entity (empty string clears the link). Self-declared.
  @IsOptional() @IsString() @MaxLength(120) linkedDrepIdOnchain?: string;
}

export class RejectSubmitterDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;
}

/** §2 — board override of a submitter↔DAO-member link (set or clear). */
export class SetSubmitterLinkDto {
  @IsOptional() @IsString() @MaxLength(120) linkedDrepIdOnchain?: string | null;
}
