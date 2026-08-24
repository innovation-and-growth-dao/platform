import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApplicationReviewGuard } from '../auth/application-review.guard';
import { DrepService } from './drep.service';

// §25.5 — board reviews Expert applications (non-DRep ADA holders for milestone review).
@Controller('admin/experts')
@UseGuards(JwtAuthGuard, ApplicationReviewGuard)
export class BoardExpertsController {
  constructor(private readonly drep: DrepService) {}

  @Get('applications')
  applications(@Query('history') history?: string) {
    return this.drep.listExpertApplications(history === '1');
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.drep.approveExpertById(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) {
    return this.drep.rejectExpertById(id);
  }
}
