import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogEntry {
  actorStaffId?: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Single write path for `/admin/audit-logs`. Kept fire-and-forget-friendly
 * (callers await it, but a failure here is logged, never allowed to roll
 * back the business mutation it's describing) — an audit trail gap is
 * recoverable, an order stuck mid-transaction because logging failed is not.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorStaffId: entry.actorStaffId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        changes: entry.changes as never,
        ipAddress: entry.ipAddress,
      },
    });
  }
}
