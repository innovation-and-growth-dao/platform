import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// §27 — comment audience tiers + who may edit the document.
const RULE_COMMENT_AUDIENCES = ['BOARD', 'MEMBERS', 'EVERYONE'];
const RULE_DOC_EDITABLE_BY = ['PROPOSER', 'PROPOSER_BOARD'];

/** One attachment on a rule document: an UPLOAD (base64 data URL + original file name) or a LINK
 *  (external / Google-Drive URL). Reused by create (initial set) + the add endpoint. */
export class RuleAttachmentDto {
  @IsIn(['UPLOAD', 'LINK']) source!: string;
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsString() dataUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) fileName?: string;
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
}

export class CreateRuleDocDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  // The body may be the full imported text of a linked file (extraction caps at 60k chars).
  @IsString() @MinLength(1) @MaxLength(120000) contentMd!: string;
  @IsOptional() expiresAt?: string | null;
  @IsOptional() @IsIn(RULE_COMMENT_AUDIENCES) commentAudience?: string;
  @IsOptional() @IsIn(RULE_DOC_EDITABLE_BY) docEditableBy?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RuleAttachmentDto) attachments?: RuleAttachmentDto[];
}

export class UpdateRuleDocDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120000) contentMd?: string;
  @IsOptional() expiresAt?: string | null;
  @IsOptional() @IsIn(RULE_COMMENT_AUDIENCES) commentAudience?: string;
  @IsOptional() @IsIn(RULE_DOC_EDITABLE_BY) docEditableBy?: string;
}

/** §27 — set/change an attachment's display name (label only; not part of the content hash). */
export class RuleRenameAttachmentDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
}

/** §27 — probe/fetch a link while composing (can we read it? / pull its full text). */
export class RuleProbeLinkDto {
  @IsString() @MaxLength(2000) url!: string;
}

export class RuleCommentDto {
  @IsString() @MinLength(1) @MaxLength(4000) contentMd!: string;
  @IsOptional() @IsString() parentId?: string; // §27 — reply to a top-level comment
}
