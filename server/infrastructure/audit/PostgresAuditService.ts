import { DatabasePool, dbPool } from '../database/pool';
import { IAuditService, AuditLogEntry, AuditLogRecord, AuditLogFilters } from '../../services/IAuditService';
import { sanitizePayload } from './auditSanitizer';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_REGEX = /^[A-Z0-9_]+$/;

export class PostgresAuditService implements IAuditService {
  constructor(private readonly pool: DatabasePool = dbPool) {}

  public async log(entry: AuditLogEntry): Promise<void> {
    try {
      // 1. Sanitize action name to adhere to check constraint ^[A-Z0-9_]+$
      let action = (entry.action || 'PRIVILEGED_MUTATION').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (!ACTION_REGEX.test(action)) {
        action = 'PRIVILEGED_MUTATION';
      }
      action = action.substring(0, 64);

      // 2. Normalize and sanitize target details
      const sanitizedDetails = sanitizePayload(entry.details || {}) as Record<string, any>;

      // 3. Normalize target ID (PostgreSQL column is UUID)
      let targetId: string | null = null;
      if (entry.targetId) {
        if (UUID_REGEX.test(entry.targetId)) {
          targetId = entry.targetId;
        } else {
          sanitizedDetails.targetIdentifier = entry.targetId;
        }
      }

      // 4. Normalize admin ID (PostgreSQL column is nullable UUID with FK users(id))
      let adminId: string | null = null;
      if (entry.adminId) {
        if (UUID_REGEX.test(entry.adminId)) {
          adminId = entry.adminId;
        } else {
          sanitizedDetails.unresolvedAdminId = entry.adminId;
        }
      }

      const targetEntity = (entry.targetEntity || 'unknown').substring(0, 64);
      const ipAddress = entry.ipAddress ? entry.ipAddress.substring(0, 45) : null;
      const userAgent = entry.userAgent ? entry.userAgent.substring(0, 255) : null;
      const createdAt = entry.createdAt || new Date();

      const insertQuery = `
        INSERT INTO audit_logs (
          admin_id,
          action,
          target_entity,
          target_id,
          details,
          ip_address,
          user_agent,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
      `;

      try {
        await this.pool.query(insertQuery, [
          adminId,
          action,
          targetEntity,
          targetId,
          JSON.stringify(sanitizedDetails),
          ipAddress,
          userAgent,
          createdAt,
        ]);
      } catch (dbErr: any) {
        // Fallback for foreign key violation (e.g. synthetic test actor ID not in users table)
        if (dbErr?.code === '23503' && adminId !== null) {
          sanitizedDetails.unreferencedAdminId = adminId;
          await this.pool.query(insertQuery, [
            null,
            action,
            targetEntity,
            targetId,
            JSON.stringify(sanitizedDetails),
            ipAddress,
            userAgent,
            createdAt,
          ]);
        } else {
          throw dbErr;
        }
      }
    } catch (err) {
      // Audit logging must not crash the application server, but should be logged to stderr
      console.error('[PostgresAuditService] Failed to write audit log entry:', err);
    }
  }

  public async queryLogs(filters: AuditLogFilters = {}): Promise<AuditLogRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.adminId && UUID_REGEX.test(filters.adminId)) {
      conditions.push(`admin_id = $${idx++}`);
      params.push(filters.adminId);
    }

    if (filters.action) {
      conditions.push(`action = $${idx++}`);
      params.push(filters.action);
    }

    if (filters.targetEntity) {
      conditions.push(`target_entity = $${idx++}`);
      params.push(filters.targetEntity);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filters.limit || 50, 200);
    const offset = Math.max(filters.offset || 0, 0);

    const query = `
      SELECT
        id,
        admin_id as "adminId",
        action,
        target_entity as "targetEntity",
        target_id as "targetId",
        details,
        ip_address as "ipAddress",
        user_agent as "userAgent",
        created_at as "createdAt"
      FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const res = await this.pool.query<any>(query, params);

    return res.rows.map((row) => ({
      id: row.id,
      adminId: row.adminId,
      action: row.action,
      targetEntity: row.targetEntity,
      targetId: row.targetId,
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: new Date(row.createdAt),
    }));
  }
}
