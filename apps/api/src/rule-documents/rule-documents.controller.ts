import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { RuleDocumentsService } from './rule-documents.service';
import { CreateRuleDocDto, RuleCommentDto, UpdateRuleDocDto } from './dto';

// §27 — Rule Documents. Reads are public (PRIVATE docs only visible to their owner); mutations
// require an admitted DRep. `mine` + `comments/:id` are declared before `:id` so they don't get
// captured by the id route.
@Controller('rule-documents')
export class RuleDocumentsController {
  constructor(private readonly svc: RuleDocumentsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  list(@Query('filter') filter?: string) {
    return this.svc.list(filter);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() ctx: AuthContext) {
    return this.svc.listMine(ctx.userId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateRuleDocDto) {
    return this.svc.create(ctx.userId, dto);
  }

  @Delete('comments/:id')
  @UseGuards(JwtAuthGuard)
  removeComment(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteComment(ctx.userId, id);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() ctx?: AuthContext) {
    return this.svc.getOne(id, ctx?.userId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRuleDocDto) {
    return this.svc.update(ctx.userId, id, dto);
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard)
  publish(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.publish(ctx.userId, id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ctx.userId, id);
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  comment(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RuleCommentDto) {
    return this.svc.addComment(ctx.userId, id, dto);
  }
}
