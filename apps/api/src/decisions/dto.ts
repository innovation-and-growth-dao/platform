import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDecisionDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) contentMd!: string;
  @IsOptional() expiresAt?: string | null; // §28 — future ISO date, or null = never (default)
}

export class UpdateDecisionDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(1) contentMd?: string;
  @IsOptional() expiresAt?: string | null; // §28 — future ISO date or null; shorten-only
}

export class DecisionCommentDto {
  @IsString() @MinLength(1) @MaxLength(4000) contentMd!: string;
  @IsOptional() @IsString() parentId?: string; // §28 — reply to a top-level comment
}
