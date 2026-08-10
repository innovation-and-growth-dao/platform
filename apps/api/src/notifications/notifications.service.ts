import { Injectable } from '@nestjs/common';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * §20.3 — in-app notification feed. The §27 background jobs write rows here (pledge grace
 * expiry, fee/pledge seen on-chain, overdue stage windows, reconciliation mismatches,
 * milestone/delivery reminders); users read them via the bell in the login card.
 * Dedupe: one row per (user, kind, refId) — jobs can safely re-run.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create one notification per user, skipping users who already have (kind, refId). */
  async notifyUsers(userIds: string[], kind: string, refId: string, payload: Record<string, unknown>) {
    let created = 0;
    for (const userId of new Set(userIds)) {
      const dup = await this.prisma.notification.findFirst({
        where: { userId, kind, payload: { path: ['refId'], equals: refId } },
        select: { id: true },
      });
      if (dup) continue;
      await this.prisma.notification.create({
        data: { userId, kind, payload: { refId, ...payload } as Prisma.InputJsonValue, channelsSent: ['inapp'] },
      });
      created++;
    }
    return created;
  }

  /** Notify every active board member. */
  async notifyBoard(kind: string, refId: string, payload: Record<string, unknown>) {
    const seats = await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } });
    const users = await this.prisma.appUser.findMany({
      where: { drepKeyHash: { in: seats.map((s) => s.drepKeyHash) } },
      select: { id: true },
    });
    return this.notifyUsers(users.map((u) => u.id), kind, refId, payload);
  }

  async listMine(userId: string, limit = 50) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      payload: n.payload as Record<string, unknown>,
      readAt: n.readAt,
      createdAt: n.createdAt,
    }));
  }

  async unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
