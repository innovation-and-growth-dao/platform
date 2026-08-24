import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { MeritModule } from './merit/merit.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PreferencesModule } from './users/preferences.module';
import { DrepModule } from './drep/drep.module';
import { AdminModule } from './admin/admin.module';
import { RoundsModule } from './rounds/rounds.module';
import { ProposalsModule } from './proposals/proposals.module';
import { GovernanceModule } from './governance/governance.module';
import { TreasuryModule } from './treasury/treasury.module';
import { PublicConfigModule } from './config/config.module';
import { CommentsModule } from './comments/comments.module';
import { MilestonesModule } from './milestones/milestones.module';
import { InternalProposalsModule } from './internal-proposals/internal-proposals.module';
import { RuleDocumentsModule } from './rule-documents/rule-documents.module';
import { DecisionsModule } from './decisions/decisions.module';
import { SubcategoriesModule } from './subcategories/subcategories.module';
import { CardanoModule } from './cardano/cardano.module';
import { RewardsModule } from './rewards/rewards.module';
import { ProposalMessagesModule } from './messages/proposal-messages.module';
import { SubmitterModule } from './submitter/submitter.module';
import { NotificationsModule } from './notifications/notifications.module';
import { JobsModule } from './jobs/jobs.module';
import { DeployModule } from './deploy/deploy.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load the monorepo root .env when running from apps/api, then a local override.
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    MeritModule,
    RedisModule,
    CardanoModule,
    HealthModule,
    UsersModule,
    AuthModule,
    DrepModule,
    AdminModule,
    RoundsModule,
    ProposalsModule,
    GovernanceModule,
    TreasuryModule,
    PublicConfigModule,
    CommentsModule,
    MilestonesModule,
    RewardsModule,
    ProposalMessagesModule,
    SubmitterModule,
    NotificationsModule,
    JobsModule,
    InternalProposalsModule,
    RuleDocumentsModule,
    DecisionsModule,
    SubcategoriesModule,
    PreferencesModule,
    DeployModule,
  ],
})
export class AppModule {}
