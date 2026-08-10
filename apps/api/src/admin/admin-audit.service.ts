import { Injectable } from '@nestjs/common';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  adminId?: string | null;
  action: string;
  target?: string | null;
  payload?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

/** Append-only admin audit log (§18.4). No update/delete in app code. */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: entry.adminId ?? null,
        action: entry.action,
        target: entry.target ?? null,
        payload: entry.payload,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }
}
