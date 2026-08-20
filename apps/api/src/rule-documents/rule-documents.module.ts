import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InternalProposalsModule } from '../internal-proposals/internal-proposals.module';
import { RuleDocumentsController } from './rule-documents.controller';
import { RuleDocumentsService } from './rule-documents.service';

// §27 — Rule Documents. AuthModule provides the guards/AuthService; InternalProposalsModule
// exports the service used for the rule-approval vote score (PrismaService is global).
@Module({
  imports: [AuthModule, InternalProposalsModule],
  controllers: [RuleDocumentsController],
  providers: [RuleDocumentsService],
})
export class RuleDocumentsModule {}
