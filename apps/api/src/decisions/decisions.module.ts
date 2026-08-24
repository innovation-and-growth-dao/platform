import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InternalProposalsModule } from '../internal-proposals/internal-proposals.module';
import { DecisionsController } from './decisions.controller';
import { DecisionsService } from './decisions.service';

// §28 — Rule Decisions. AuthModule provides the guards/AuthService; InternalProposalsModule
// exports the service used for the rule-approval vote score (PrismaService is global).
@Module({
  imports: [AuthModule, InternalProposalsModule],
  controllers: [DecisionsController],
  providers: [DecisionsService],
})
export class DecisionsModule {}
