import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRuleDocDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) contentMd!: string;
}

export class UpdateRuleDocDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(1) contentMd?: string;
}

export class RuleCommentDto {
  @IsString() @MinLength(1) @MaxLength(4000) contentMd!: string;
  @IsOptional() @IsString() parentId?: string; // §27 — reply to a top-level comment
}
