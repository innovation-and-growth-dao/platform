import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { InternalProposalsService } from './internal-proposals.service';
import { CreateInternalProposalDto, SaveDraftDto, VoteInternalDto, SaveDocumentDto, AddAttachmentDto, RenameAttachmentDto, OpenVotingDto, ProbeLinkDto } from './dto';

// §10 — internal proposals (threshold voting / polls). Any authenticated user reads the public
// ones; PRIVATE ones are filtered to board members inside the service.
@Controller('internal-proposals')
@UseGuards(JwtAuthGuard)
export class InternalProposalsController {
  constructor(private readonly internal: InternalProposalsService) {}

  @Get()
  list(@CurrentUser() c: AuthContext) {
    return this.internal.list(c.userId);
  }

  // Static route must come BEFORE @Get(':id') (UUID pipe would reject 'pending-count').
  @Get('pending-count')
  pendingCount(@CurrentUser() c: AuthContext) {
    return this.internal.pendingCount(c.userId);
  }

  // §10 — drafts: author-only work-in-progress (status DRAFT, no voting). Create / update / delete.
  @Post('drafts')
  saveDraft(@CurrentUser() c: AuthContext, @Body() dto: SaveDraftDto) {
    return this.internal.saveDraft(c.userId, dto);
  }

  @Patch('drafts/:id')
  updateDraft(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveDraftDto) {
    return this.internal.updateDraft(c.userId, id, dto);
  }

  @Delete('drafts/:id')
  deleteDraft(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.internal.deleteDraft(c.userId, id);
  }

  @Get(':id')
  get(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.internal.detail(id, c.userId);
  }

  @Post()
  submit(@CurrentUser() c: AuthContext, @Body() dto: CreateInternalProposalDto) {
    return this.internal.submit(c.userId, dto);
  }

  // §10 — board member soft-deletes a submitted proposal (kept as DELETED for the record). The
  // service enforces the board-only check. Route is one segment, so it never collides with drafts/:id.
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.internal.deleteProposal(c.userId, id);
  }

  @Post(':id/vote')
  vote(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoteInternalDto) {
    return this.internal.vote(c.userId, id, dto);
  }

  @Post(':id/finalize')
  finalize(@Param('id', ParseUUIDPipe) id: string) {
    return this.internal.finalize(id);
  }

  // §14 — board member triggers the new-board installation early (after the election is APPROVED).
  @Post(':id/install-board')
  installBoard(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.internal.installNewBoard(c.userId, id);
  }

  // §10 — push out the voting deadline (election: submitter only; otherwise board only; must be enabled).
  @Post(':id/extend')
  @UseGuards(JwtAuthGuard)
  extend(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: { votingEndAt: string }) {
    return this.internal.extend(c.userId, id, dto.votingEndAt);
  }

  // §30 — "Document for public comment": create (→ status COMMENT), edit while in comment phase,
  // manage attachments (files/links), download an uploaded file, and open voting (author/board).
  @Post('document')
  @UseGuards(JwtAuthGuard)
  createDocument(@CurrentUser() c: AuthContext, @Body() dto: SaveDocumentDto) {
    return this.internal.saveForComment(c.userId, dto);
  }

  @Patch('document/:id')
  @UseGuards(JwtAuthGuard)
  updateDocument(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveDocumentDto) {
    return this.internal.updateDocument(c.userId, id, dto);
  }

  // §30 — probe a link while composing (can we fetch + read it?), so the author gets a readability check.
  @Post('probe-link')
  @UseGuards(JwtAuthGuard)
  probeLink(@Body() dto: ProbeLinkDto) {
    return this.internal.probeLink(dto.url);
  }

  // §30 — pull a link's full text so the author can insert it as the document body while composing.
  @Post('fetch-link')
  @UseGuards(JwtAuthGuard)
  fetchLink(@Body() dto: ProbeLinkDto) {
    return this.internal.fetchLinkText(dto.url);
  }

  @Post(':id/attachments')
  @UseGuards(JwtAuthGuard)
  addAttachment(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddAttachmentDto) {
    return this.internal.addAttachment(c.userId, id, dto);
  }

  @Delete(':id/attachments/:attId')
  @UseGuards(JwtAuthGuard)
  removeAttachment(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string) {
    return this.internal.removeAttachment(c.userId, id, attId);
  }

  // §30 — name (or rename) an already-added file/link; works retroactively while open for comment.
  @Patch(':id/attachments/:attId')
  @UseGuards(JwtAuthGuard)
  renameAttachment(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string, @Body() dto: RenameAttachmentDto) {
    return this.internal.renameAttachment(c.userId, id, attId, dto.title);
  }

  // Public read of an uploaded file (the service enforces the private-document gate).
  @Get(':id/attachments/:attId/file')
  @UseGuards(OptionalJwtAuthGuard)
  attachmentFile(@Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string, @CurrentUser() c?: AuthContext) {
    return this.internal.getAttachmentFile(id, attId, c?.userId ?? null);
  }

  @Post(':id/open-voting')
  @UseGuards(JwtAuthGuard)
  openVoting(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OpenVotingDto) {
    return this.internal.openVoting(c.userId, id, dto);
  }
}
