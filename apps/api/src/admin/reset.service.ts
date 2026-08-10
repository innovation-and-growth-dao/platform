import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * §23 — destructive ADMIN reset for testnet rehearsals. Wipes everything that
 * makes up "the DAO's working state" — proposals, votes, rounds, board, the
 * multisig setup — while keeping:
 *   • AdminUser / AdminAuth / AdminAuditLog (you still need to log in as admin),
 *   • PlatformSecret (the anchor hot-wallet seed — rotating that is a separate ceremony),
 *   • PlatformConfig overrides (governance parameters stay tuned).
 *
 * After running, the platform looks like a fresh install — re-upload the
 * founding-board JSON, board members provide their multisig keys, the
 * platform assembles the address, and you can run a clean round end-to-end.
 */
@Injectable()
export class ResetService {
  private readonly logger = new Logger(ResetService.name);

  constructor(private readonly prisma: PrismaService) {}

  async wipeAll() {
    // FK-ordered TRUNCATE CASCADE for everything that depends on proposals /
    // rounds / board. Wrapped in a transaction so a failure leaves the DB
    // unchanged. CASCADE handles transitive children we don't list explicitly
    // (votes, comments, snapshots, attempt rows, etc.).
    const tables = [
      // multisig + treasury
      'multisig_signature',
      'multisig_action',
      'multisig_config',
      'board_multisig_key',
      'hot_wallet_sweep',
      // milestone / POA / votes
      'milestone_poa',
      'milestone_assignment',
      'vote',
      'vote_snapshot_entry',
      'vote_snapshot',
      'stop_funding_vote',
      'stop_funding_proposal',
      'milestone',
      // proposals + their attachments
      'comment',
      'budget_change_request',
      'proposal_version',
      'filter_assignment',
      'proposal',
      // rounds
      'round_drep_eligibility',
      'round_category',
      'round_schedule',
      'round',
      // anchors + rewards
      'anchor',
      'reward_entry',
      'reward_calculation',
      // board + DRep registry
      'board_seat',
      'drep',
      'expert',
      'private_message',
      'notification',
      'notification_preference',
    ];
    await this.prisma.$transaction(async (tx) => {
      // Set genesis state back to "not approved" so the upload+approve flow
      // can run again from a clean slate.
      await tx.platformState.updateMany({
        data: { genesisApprovedAt: null, genesisApprovedBy: null, genesisPayload: undefined as never },
      });
      // §15.4 — reward addresses are tied to "this user is a DRep / board
      // member who gets paid". DRep registry is wiped, so the address is
      // meaningless until the user is re-admitted — clear it on every
      // app_user row so the post-reset state matches a fresh install.
      await tx.appUser.updateMany({ data: { rewardPaymentAddress: null } });
      // ONE TRUNCATE statement with a comma-separated table list. Prisma sends
      // queries as prepared statements which reject ';' multi-command bodies;
      // CASCADE handles transitive children (votes, comments, snapshots, …).
      // We deliberately don't TRUNCATE app_user so the admin's session and
      // related users keep working — they'll be re-derived on next login.
      const list = tables.map((t) => `"${t}"`).join(', ');
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    });
    this.logger.warn('ADMIN RESET — DAO state wiped (proposals, rounds, board, multisig, votes, anchors, rewards).');
    return { ok: true, wipedTables: tables.length };
  }
}
