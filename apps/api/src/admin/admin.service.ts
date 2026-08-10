import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** Read-only data for the admin dashboard (§18.9). */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async health() {
    const [dbUp, redisUp, state, boardCount, adminCount] = await Promise.all([
      this.prisma
        .$queryRaw`SELECT 1`.then(() => true)
        .catch(() => false),
      this.redis.ping(),
      this.prisma.platformState.findUnique({ where: { id: 1 } }),
      this.prisma.boardMembership.count({ where: { endedAt: null } }),
      this.prisma.adminUser.count({ where: { status: 'ACTIVE' } }),
    ]);
    return {
      database: dbUp ? 'up' : 'down',
      redis: redisUp ? 'up' : 'down',
      genesisApproved: state?.genesisApprovedAt != null,
      maintenanceMode: state?.maintenanceMode ?? false,
      paused: state?.paused ?? false,
      boardCount,
      adminCount,
      time: new Date().toISOString(),
    };
  }

  async listAdmins() {
    return this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  async auditLog(limit = 50) {
    const rows = await this.prisma.adminAuditLog.findMany({
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit, 200),
      include: { admin: { select: { username: true } } },
    });
    return rows.map((r) => ({
      action: r.action,
      target: r.target,
      adminUsername: r.admin?.username ?? null,
      ip: r.ip,
      occurredAt: r.occurredAt,
    }));
  }
}
