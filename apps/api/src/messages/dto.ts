import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class MessageBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(10000) body!: string;
}

export class QuickPollVoteDto {
  // §9.2 — ranked priority: candidate proposal ids ordered highest-priority first.
  @IsArray() @ArrayNotEmpty() @IsUUID('all', { each: true }) ranking!: string[];
}
