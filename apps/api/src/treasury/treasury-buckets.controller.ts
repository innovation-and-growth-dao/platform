import { IsBoolean, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { TreasuryBucketsService } from './treasury-buckets.service';

export class CreateBucketDto {
  @IsString() @MinLength(2) @MaxLength(64) label!: string;
}
export class RenameBucketDto {
  @IsString() @MinLength(2) @MaxLength(64) label!: string;
}
export class SetDefaultDto {
  @IsIn(['FUNDING', 'REWARDS', 'OPERATIONS', 'SUBMISSION_FEES', 'PLEDGE'])
  operation!: 'FUNDING' | 'REWARDS' | 'OPERATIONS' | 'SUBMISSION_FEES' | 'PLEDGE';
  @IsBoolean() value!: boolean;
}

@Controller()
export class TreasuryBucketsController {
  constructor(private readonly buckets: TreasuryBucketsService) {}

  /** Public — list of treasury buckets (sub-addresses) with live balances. */
  @UseGuards(JwtAuthGuard)
  @Get('dao/treasury/buckets')
  list() {
    return this.buckets.list();
  }

  /** Board-only — create a labeled bucket under the active multisig. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/treasury/buckets')
  create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateBucketDto) {
    return this.buckets.create(ctx.userId, dto.label);
  }

  /** Board-only — cosmetic rename (address stays the same). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Patch('admin/treasury/buckets/:id')
  rename(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameBucketDto) {
    return this.buckets.rename(ctx.userId, id, dto.label);
  }

  /** Board-only — delete an EMPTY bucket. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Delete('admin/treasury/buckets/:id')
  remove(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.buckets.remove(ctx.userId, id);
  }

  /** Board-only — toggle a per-operation default flag (FUNDING / REWARDS /
   *  OPERATIONS). Setting true auto-unflags any other bucket holding the
   *  same operation's default in the active multisig. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/treasury/buckets/:id/default')
  setDefault(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDefaultDto) {
    return this.buckets.setDefault(ctx.userId, id, dto.operation, dto.value);
  }
}
