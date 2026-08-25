import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from './admin.guard';
import { CurrentAdmin } from './current-admin.decorator';
import type { AdminIdentity } from './admin-auth.service';
import { GenesisService } from './genesis.service';
import { GenesisBoardMemberDto, GenesisRemoveDto, GenesisUploadDto } from './dto';

// §18.7 / §26.6 — genesis approval (board bootstrap). Admin-only.
@Controller('sysadmin/genesis')
@UseGuards(AdminGuard)
export class SysadminGenesisController {
  constructor(private readonly genesis: GenesisService) {}

  @Get()
  state() {
    return this.genesis.getState();
  }

  @Post('upload')
  upload(@CurrentAdmin() admin: AdminIdentity, @Body() dto: GenesisUploadDto) {
    return this.genesis.upload(admin.adminId, dto.genesis);
  }

  @Post('approve')
  approve(@CurrentAdmin() admin: AdminIdentity, @Req() req: Request) {
    const ip = req.ip /* SEC-06: trusted framework IP, not spoofable XFF */;
    return this.genesis.approve(admin.adminId, ip, req.headers['user-agent']);
  }

  @Post('reject')
  reject(@CurrentAdmin() admin: AdminIdentity) {
    return this.genesis.reject(admin.adminId);
  }

  // Manual insert — one board member at a time (name + drep_id), verified on-chain.
  @Post('board')
  addMember(@CurrentAdmin() admin: AdminIdentity, @Body() dto: GenesisBoardMemberDto, @Req() req: Request) {
    const ip = req.ip /* SEC-06: trusted framework IP, not spoofable XFF */;
    return this.genesis.addBoardMember(admin.adminId, dto.name, dto.drep_id, ip, req.headers['user-agent']);
  }

  // Remove a single board member by drep_id (frees a seat; file can be re-loaded after).
  @Post('board/remove')
  removeMember(@CurrentAdmin() admin: AdminIdentity, @Body() dto: GenesisRemoveDto, @Req() req: Request) {
    const ip = req.ip /* SEC-06: trusted framework IP, not spoofable XFF */;
    return this.genesis.removeBoardMember(admin.adminId, dto.drep_id, ip, req.headers['user-agent']);
  }
}
