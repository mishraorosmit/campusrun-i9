import { IAuditService, AuditLogEntry, AuditLogRecord, AuditLogFilters } from '../../services/IAuditService';
import { sanitizePayload } from './auditSanitizer';
import crypto from 'crypto';

export class InMemoryAuditService implements IAuditService {
  private logs: AuditLogRecord[] = [];

  public async log(entry: AuditLogEntry): Promise<void> {
    const record: AuditLogRecord = {
      id: crypto.randomUUID(),
      adminId: entry.adminId || null,
      action: entry.action,
      targetEntity: entry.targetEntity,
      targetId: entry.targetId || null,
      details: sanitizePayload(entry.details || {}) as Record<string, any>,
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
      createdAt: entry.createdAt || new Date(),
    };

    this.logs.unshift(record); // Prepend so newest is first
  }

  public async queryLogs(filters: AuditLogFilters = {}): Promise<AuditLogRecord[]> {
    let result = [...this.logs];

    if (filters.adminId) {
      result = result.filter((l) => l.adminId === filters.adminId);
    }
    if (filters.action) {
      result = result.filter((l) => l.action === filters.action);
    }
    if (filters.targetEntity) {
      result = result.filter((l) => l.targetEntity === filters.targetEntity);
    }

    const offset = Math.max(filters.offset || 0, 0);
    const limit = Math.min(filters.limit || 50, 200);

    return result.slice(offset, offset + limit);
  }

  public clear(): void {
    this.logs = [];
  }

  public getAll(): AuditLogRecord[] {
    return [...this.logs];
  }
}
