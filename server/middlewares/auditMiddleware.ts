import { Request, Response, NextFunction } from 'express';
import { IAuditService, AuditResult } from '../services/IAuditService';
import { sanitizePayload, sanitizeHeaders } from '../infrastructure/audit/auditSanitizer';

export interface AuditActionOptions {
  action: string;
  targetEntity: string;
  getTargetId?: (req: Request) => string | undefined;
}

declare global {
  namespace Express {
    interface Request {
      auditMetadata?: {
        action: string;
        targetEntity: string;
        targetId?: string;
      };
    }
  }
}

/**
 * Resolves action, targetEntity, and targetId from request method, URL path, and params.
 */
function resolveMutationDetails(req: Request): { action: string; targetEntity: string; targetId?: string } {
  // If explicitly declared via route metadata, prioritize it
  if (req.auditMetadata) {
    return req.auditMetadata;
  }

  const method = req.method.toUpperCase();
  const path = req.originalUrl || req.baseUrl + req.path;

  // 1. Spawns
  if (path.includes('/spawns')) {
    const spawnMatch = path.match(/\/spawns\/([^\/?#]+)/);
    const targetId = spawnMatch ? spawnMatch[1] : (req.params?.id as string | undefined);

    if (method === 'POST') {
      return { action: 'SPAWN_CREATE', targetEntity: 'spawn_points' };
    }
    if (path.includes('/toggle')) {
      return { action: 'SPAWN_TOGGLE', targetEntity: 'spawn_points', targetId };
    }
    if (method === 'PUT' || method === 'PATCH') {
      return { action: 'SPAWN_EDIT', targetEntity: 'spawn_points', targetId };
    }
    if (method === 'DELETE') {
      return { action: 'SPAWN_DELETE', targetEntity: 'spawn_points', targetId };
    }
  }

  // 2. Rotation
  if (path.includes('/rotation/config')) {
    return { action: 'ROTATION_CONFIG_UPDATE', targetEntity: 'rotation' };
  }
  if (path.endsWith('/rotate') || path.includes('/rotate/')) {
    return { action: 'ROTATION_TRIGGER', targetEntity: 'rotation' };
  }

  // 3. Weekly cycles
  if (path.includes('/cycles/config')) {
    return { action: 'WEEKLY_RESET_CONFIG_UPDATE', targetEntity: 'weekly_cycles' };
  }
  if (path.includes('/cycles/reset') || path.endsWith('/reset')) {
    return { action: 'WEEKLY_RESET_TRIGGER', targetEntity: 'weekly_cycles' };
  }

  // 4. Game settings
  if (path.includes('/settings')) {
    return { action: 'GAME_SETTINGS_UPDATE', targetEntity: 'game_settings' };
  }

  // Generic fallback for any other admin mutation
  const cleanPath = path.replace(/^\/api\/v\d+\/admin\/?/, '').split('/')[0] || 'resource';
  const action = `ADMIN_${method}_${cleanPath.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
  return { action, targetEntity: cleanPath };
}

/**
 * Reusable Router-Level Middleware:
 * Audits all administrative mutation attempts (POST, PUT, PATCH, DELETE).
 * Captures successful mutations, unauthenticated rejections (401), unauthorized rejections (403),
 * and client/server failures (400, 500).
 */
export function auditAdminMutations(auditService: IAuditService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only audit mutation operations (POST, PUT, PATCH, DELETE)
    const method = req.method.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next();
    }

    const startTime = Date.now();

    // Intercept res.json to capture error response details if rejected
    let responseBody: any = null;
    const originalJson = res.json.bind(res);
    res.json = (body: any): Response => {
      responseBody = body;
      return originalJson(body);
    };

    // Hook response finish event
    res.on('finish', () => {
      // Fire-and-forget audit log so response flow is completely unaffected
      (async () => {
        try {
          const { action, targetEntity, targetId } = resolveMutationDetails(req);
          const statusCode = res.statusCode;

          // Determine Result
          let result: AuditResult;
          if (statusCode >= 200 && statusCode < 300) {
            result = 'SUCCESS';
          } else if (statusCode === 401 || statusCode === 403) {
            result = 'DENIED';
          } else {
            result = 'FAILED';
          }

          // Acting user ID (UUID from authenticated session, null if unauthenticated)
          const adminId = req.user?.id || null;

          // Request metadata necessary for investigation
          const ipAddress =
            (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
            req.socket.remoteAddress ||
            req.ip ||
            null;
          const userAgent = (req.headers['user-agent'] as string) || null;

          // Prepare investigation details payload
          const details: Record<string, any> = {
            result,
            statusCode,
            durationMs: Date.now() - startTime,
            httpMethod: method,
            path: req.originalUrl || req.path,
            params: sanitizePayload(req.params),
            query: sanitizePayload(req.query),
          };

          // Sanitize and attach request body if present
          if (req.body && Object.keys(req.body).length > 0) {
            details.requestBody = sanitizePayload(req.body);
          }

          // Attach response error context if available
          if (responseBody && responseBody.error) {
            details.error = {
              code: responseBody.error.code,
              message: responseBody.error.message,
            };
          }

          // Sanitize investigation details
          const sanitizedDetails = sanitizePayload(details) as Record<string, any>;

          await auditService.log({
            adminId,
            action,
            targetEntity,
            targetId: targetId || (req.params?.id as string | undefined),
            details: sanitizedDetails,
            ipAddress,
            userAgent,
            createdAt: new Date(),
          });
        } catch (auditErr) {
          console.error('[auditAdminMutations] Unexpected error recording audit log:', auditErr);
        }
      })();
    });

    next();
  };
}

/**
 * Route-specific explicit audit middleware helper.
 */
export function auditAdminAction(auditService: IAuditService, options: AuditActionOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    req.auditMetadata = {
      action: options.action,
      targetEntity: options.targetEntity,
      targetId: options.getTargetId ? options.getTargetId(req) : (req.params?.id as string | undefined),
    };
    return auditAdminMutations(auditService)(req, res, next);
  };
}
