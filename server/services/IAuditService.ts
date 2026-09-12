export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILED';

export interface AuditLogEntry {
  adminId?: string | null;
  action: string;
  targetEntity: string;
  targetId?: string | null;
  details?: Record<string, any>;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
}

export interface AuditLogRecord {
  id: string;
  adminId: string | null;
  action: string;
  targetEntity: string;
  targetId: string | null;
  details: Record<string, any>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface AuditLogFilters {
  adminId?: string;
  action?: string;
  targetEntity?: string;
  limit?: number;
  offset?: number;
}

export interface IAuditService {
  log(entry: AuditLogEntry): Promise<void>;
  queryLogs(filters?: AuditLogFilters): Promise<AuditLogRecord[]>;
}
