/**
 * Project I9 — Phase 04 & 05 Complete Authorization Security & Audit Verification
 * 
 * Verifies:
 * 1. STUDENT cannot access admin endpoints
 * 2. STUDENT cannot mutate admin resources
 * 3. ADMIN status is resolved server-side
 * 4. Client-supplied roles are ignored
 * 5. Client-supplied user IDs cannot alter authorization context
 * 6. Authentication is required before authorization
 * 7. Every admin mutation is protected
 * 8. Audit logging covers privileged operations (successful, student-denied, unauthenticated)
 * 9. Authorization failures do not leak sensitive information
 * 10. No frontend-only security assumptions
 * 11. Strict scrubbing of passwords, OAuth secrets, session secrets, access tokens, and Web Push credentials
 */

import { createApp } from './server/app';
import { GoogleOidcClient } from './server/infrastructure/auth/GoogleOidcClient';
import { JwtUtils } from './server/infrastructure/auth/JwtUtils';
import { PostgresPlayerRepository } from './server/infrastructure/repositories/postgres/PostgresPlayerRepository';
import { PostgresAuditService } from './server/infrastructure/audit/PostgresAuditService';
import { dbPool } from './server/infrastructure/database/pool';
import { config } from './server/config';
import { InMemorySpawnRepository } from './server/infrastructure/repositories/inmemory/InMemorySpawnRepository';
import { SpawnPoint } from './server/domain/entities/SpawnPoint';
import http from 'http';
import crypto from 'crypto';

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
}

async function request(
  serverUrl: string,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      ...headers,
    };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: reqHeaders,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({
          status: res.statusCode || 500,
          headers: res.headers,
          body: parsed,
        });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion FAILED: ${message}`);
    throw new Error(`Assertion FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

function createTestSpawn(id: string, code: string): SpawnPoint {
  return new SpawnPoint({
    id,
    code,
    title: 'Test Spawn',
    zoneId: 'zone-1',
    zoneName: 'Central Campus',
    coordinates: { lat: 12.9716, lng: 77.5946 },
    svgCoordinates: { x: 100, y: 100 },
    points: 50,
    tier: 'tier1',
    status: 'active',
    claimRadiusMeters: 25,
    enabled: true,
    expiresAt: new Date(Date.now() + 3600000),
    claimCount: 0,
  });
}

async function runAuditSecuritySuite() {
  console.log('================================================================');
  console.log('  PROJECT I9 — PHASE 04 & 05 FINAL AUTHORIZATION SECURITY AUDIT');
  console.log('================================================================');

  // Initialize DB pool
  dbPool.initialize({
    connectionString: config.DATABASE_URL,
    max: 10,
    min: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statementTimeoutMillis: 10000,
  });

  const playerRepo = new PostgresPlayerRepository(dbPool);
  const auditService = new PostgresAuditService(dbPool);
  const spawnRepo = new InMemorySpawnRepository();

  const app = createApp({
    playerRepo,
    auditService,
    spawnRepo,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[Test Server] Running at ${baseUrl}\n`);

  try {
    // 0. Setup test users in PostgreSQL
    const studentId = crypto.randomUUID();
    const studentEmail = `student-${Date.now()}@${config.AUTH_COLLEGE_DOMAIN}`;
    const adminId = crypto.randomUUID();
    const adminEmail = `admin-${Date.now()}@${config.AUTH_COLLEGE_DOMAIN}`;

    // Seed student
    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [studentId, studentEmail]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name) VALUES ($1, $2, $3);`,
      [studentId, `student_${Date.now()}`.substring(0, 20), 'Test Student']
    );

    // Seed admin
    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [adminId, adminEmail]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name) VALUES ($1, $2, $3);`,
      [adminId, `admin_${Date.now()}`.substring(0, 20), 'Test Admin']
    );
    await dbPool.query(
      `INSERT INTO admins (user_id, role, granted_by) VALUES ($1, 'superadmin', $1);`,
      [adminId]
    );

    console.log(`[Setup] Seeded test STUDENT: ${studentId} (${studentEmail})`);
    console.log(`[Setup] Seeded test ADMIN:   ${adminId} (${adminEmail})\n`);

    // Mint valid tokens
    const studentToken = JwtUtils.sign(
      { sub: studentId, email: studentEmail, username: 'student', role: 'STUDENT' },
      config.JWT_SECRET,
      3600
    );

    const adminToken = JwtUtils.sign(
      { sub: adminId, email: adminEmail, username: 'admin', role: 'ADMIN' },
      config.JWT_SECRET,
      3600
    );

    // Expired admin token
    const expiredAdminToken = JwtUtils.sign(
      { sub: adminId, email: adminEmail, username: 'admin', role: 'ADMIN' },
      config.JWT_SECRET,
      -3600 // Expired 1 hour ago
    );

    // Forged student token attempting to claim role: 'ADMIN' using the wrong secret
    const forgedAdminToken = JwtUtils.sign(
      { sub: studentId, email: studentEmail, username: 'student', role: 'ADMIN' },
      'wrong-secret-hacker-key',
      3600
    );

    console.log('--- SECTION 1: Unauthenticated Access & Mutation Protection ---');
    {
      // Unauthenticated query probe
      const resQuery = await request(baseUrl, 'GET', '/api/v1/admin/overview');
      assert(resQuery.status === 401, 'Unauthenticated query rejected with 401 Unauthorized');
      assert(resQuery.body.error?.code === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED');

      // Unauthenticated mutation probe
      const resMut = await request(baseUrl, 'POST', '/api/v1/admin/spawns', {}, {
        name: 'Hacked Spawn',
      });
      assert(resMut.status === 401, 'Unauthenticated mutation rejected with 401 Unauthorized');

      // Wait a tick for async audit log write
      await new Promise((r) => setTimeout(r, 150));

      const logs = await auditService.queryLogs({ action: 'SPAWN_CREATE', limit: 1 });
      assert(logs.length > 0, 'Audit log recorded unauthenticated mutation probe');
      assert(logs[0].adminId === null, 'Acting admin_id is NULL for unauthenticated attempt');
      assert(logs[0].details.result === 'DENIED', 'Audit log result is DENIED');
      assert(logs[0].details.statusCode === 401, 'Audit log records HTTP 401');
    }

    console.log('\n--- SECTION 2: Authenticated Student Authorization Defense ---');
    {
      // Student query probe
      const resQuery = await request(
        baseUrl,
        'GET',
        '/api/v1/admin/overview',
        { Authorization: `Bearer ${studentToken}` }
      );
      assert(resQuery.status === 403, 'Authenticated student rejected from admin query with 403 Forbidden');
      assert(resQuery.body.error?.code === 'FORBIDDEN', 'Error code is FORBIDDEN');

      // Student mutation probe
      const resMut = await request(
        baseUrl,
        'POST',
        '/api/v1/admin/rotate',
        { Authorization: `Bearer ${studentToken}` }
      );
      assert(resMut.status === 403, 'Authenticated student rejected from admin mutation with 403 Forbidden');

      await new Promise((r) => setTimeout(r, 150));

      const logs = await auditService.queryLogs({ action: 'ROTATION_TRIGGER', limit: 1 });
      assert(logs.length > 0, 'Audit log recorded student denied mutation');
      assert(logs[0].adminId === studentId, 'Audit log records student user ID as acting actor');
      assert(logs[0].details.result === 'DENIED', 'Audit log result is DENIED');
      assert(logs[0].details.statusCode === 403, 'Audit log records HTTP 403');
    }

    console.log('\n--- SECTION 3: Forged Role & Signature Tampering Defense ---');
    {
      // 1. Student sending forged token signed with wrong secret
      const resTampered = await request(
        baseUrl,
        'POST',
        '/api/v1/admin/spawns',
        { Authorization: `Bearer ${forgedAdminToken}` },
        { name: 'Forged' }
      );
      assert(resTampered.status === 401, 'Forged JWT with wrong secret rejected with 401 Unauthorized');

      // 2. Student sending valid student JWT but injecting role: 'ADMIN' in request body
      const resBodyRole = await request(
        baseUrl,
        'POST',
        '/api/v1/admin/spawns',
        { Authorization: `Bearer ${studentToken}` },
        { role: 'ADMIN', isAdmin: true, name: 'Privilege Escalation Attempt' }
      );
      assert(resBodyRole.status === 403, 'Client-supplied role in body is strictly ignored; yields 403 Forbidden');

      // 3. Student injecting headers X-User-Role: ADMIN
      const resHeaderRole = await request(
        baseUrl,
        'POST',
        '/api/v1/admin/spawns',
        {
          Authorization: `Bearer ${studentToken}`,
          'X-User-Role': 'ADMIN',
          'X-Admin-Override': 'true',
        },
        { name: 'Header Escalation Attempt' }
      );
      assert(resHeaderRole.status === 403, 'Client-supplied role in headers is strictly ignored; yields 403 Forbidden');
    }

    console.log('\n--- SECTION 4: Forged User ID & Context Integrity ---');
    {
      // Student attempting to spoof admin user ID in body or query on student endpoint
      const resSpoof = await request(
        baseUrl,
        'GET',
        `/api/v1/player/me?userId=${adminId}`,
        { Authorization: `Bearer ${studentToken}` }
      );
      assert(resSpoof.status === 200, 'Student profile request succeeds');
      assert(resSpoof.body.data?.id === studentId, 'Context resolved strictly from server JWT, NOT client query param');
      assert(resSpoof.body.data?.id !== adminId, 'Admin ID spoof was completely ignored');
    }

    console.log('\n--- SECTION 5: Expired Session Attempting Admin Access ---');
    {
      const resExpired = await request(
        baseUrl,
        'POST',
        '/api/v1/admin/cycles/reset',
        { Authorization: `Bearer ${expiredAdminToken}` }
      );
      assert(resExpired.status === 401, 'Expired admin token rejected with 401 Unauthorized');
      assert(resExpired.body.error?.code === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED');
    }

    console.log('\n--- SECTION 6: Authorized Admin Mutation & Audit Trail ---');
    {
      const targetSpawnId = crypto.randomUUID();
      await spawnRepo.save(createTestSpawn(targetSpawnId, 'SPWN-ALPHA'));

      // 1. Admin creates spawn
      const resCreate = await request(
        baseUrl,
        'POST',
        '/api/v1/admin/spawns',
        { Authorization: `Bearer ${adminToken}` },
        { name: 'Admin Spawn Alpha' }
      );
      assert(resCreate.status === 201, 'Admin spawn creation succeeded with 201 Created');

      // 2. Admin toggles spawn with UUID
      const resToggle = await request(
        baseUrl,
        'PATCH',
        `/api/v1/admin/spawns/${targetSpawnId}/toggle`,
        { Authorization: `Bearer ${adminToken}` },
        { enabled: true }
      );
      assert(resToggle.status === 200, 'Admin toggle spawn succeeded with 200 OK');

      // 3. Admin triggers rotation
      const resRotate = await request(
        baseUrl,
        'POST',
        '/api/v1/admin/rotate',
        { Authorization: `Bearer ${adminToken}` }
      );
      assert(resRotate.status === 200, 'Admin rotation succeeded with 200 OK');

      // 4. Admin updates settings
      const resSettings = await request(
        baseUrl,
        'PUT',
        '/api/v1/admin/settings',
        { Authorization: `Bearer ${adminToken}` },
        { 'engine.rotation_interval_minutes': 60 }
      );
      assert(resSettings.status === 200, 'Admin settings mutation succeeded with 200 OK');

      await new Promise((r) => setTimeout(r, 200));

      // Verify Audit Logs in PostgreSQL
      const toggleLogs = await auditService.queryLogs({ action: 'SPAWN_TOGGLE', limit: 1 });
      assert(toggleLogs.length > 0, 'SPAWN_TOGGLE logged to audit_logs');
      assert(toggleLogs[0].adminId === adminId, 'Acting adminId matches admin user');
      assert(toggleLogs[0].targetId === targetSpawnId, 'UUID targetId successfully populated in target_id column');
      assert(toggleLogs[0].details.result === 'SUCCESS', 'Result marked SUCCESS');
      assert(toggleLogs[0].details.statusCode === 200, 'Status code 200 recorded');

      const rotateLogs = await auditService.queryLogs({ action: 'ROTATION_TRIGGER', limit: 5 });
      const successRotate = rotateLogs.find((l) => l.details.result === 'SUCCESS');
      assert(!!successRotate, 'Successful ROTATION_TRIGGER logged');
      assert(successRotate?.adminId === adminId, 'Acting adminId matches admin user');

      const settingsLogs = await auditService.queryLogs({ action: 'GAME_SETTINGS_UPDATE', limit: 1 });
      assert(settingsLogs.length > 0, 'GAME_SETTINGS_UPDATE logged to audit_logs');
      assert(settingsLogs[0].details.result === 'SUCCESS', 'Settings mutation marked SUCCESS');
    }

    console.log('\n--- SECTION 7: Strict Secret & Credential Redaction Verification ---');
    {
      // Perform admin mutation with body containing every sensitive credential type
      const sensitivePayload = {
        name: 'Sensitive Spawn',
        password: 'SuperSecretAdminPassword123!',
        newPassword: 'AnotherSecretPassword456!',
        client_secret: 'google-oauth-client-secret-999',
        code_verifier: 'pkce-verifier-token-xyz',
        session_token: 'active-session-secret-token',
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.sig',
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.sig',
        pushSubscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/sample',
          keys: {
            auth: 'push-auth-secret-key-777',
            p256dh: 'push-p256dh-crypto-key-888',
          },
        },
      };

      const resSens = await request(
        baseUrl,
        'POST',
        '/api/v1/admin/spawns',
        {
          Authorization: `Bearer ${adminToken}`,
          Cookie: 'session_id=secret-cookie-value; token=secret-token',
        },
        sensitivePayload
      );
      assert(resSens.status === 201, 'Mutation processed successfully');

      await new Promise((r) => setTimeout(r, 200));

      const recentLogs = await auditService.queryLogs({ action: 'SPAWN_CREATE', limit: 5 });
      const sensitiveLog = recentLogs[0];
      assert(!!sensitiveLog, 'Recent spawn creation audit log retrieved');

      const loggedBody = sensitiveLog.details.requestBody;
      assert(loggedBody.password === '[REDACTED]', 'password field scrubbed to [REDACTED]');
      assert(loggedBody.newPassword === '[REDACTED]', 'newPassword field scrubbed to [REDACTED]');
      assert(loggedBody.client_secret === '[REDACTED]', 'client_secret field scrubbed to [REDACTED]');
      assert(loggedBody.code_verifier === '[REDACTED]', 'code_verifier field scrubbed to [REDACTED]');
      assert(loggedBody.session_token === '[REDACTED]', 'session_token field scrubbed to [REDACTED]');
      assert(loggedBody.access_token === '[REDACTED]', 'access_token field scrubbed to [REDACTED]');
      assert(loggedBody.jwt === '[REDACTED]', 'jwt token value scrubbed to [REDACTED]');
      assert(loggedBody.pushSubscription.keys.auth === '[REDACTED]', 'Web Push "auth" credential scrubbed to [REDACTED]');
      assert(loggedBody.pushSubscription.keys.p256dh === '[REDACTED]', 'Web Push "p256dh" credential scrubbed to [REDACTED]');

      // Check that sensitive headers were NOT saved
      const detailsStr = JSON.stringify(sensitiveLog.details);
      assert(!detailsStr.includes('SuperSecretAdminPassword123!'), 'No raw password in audit log');
      assert(!detailsStr.includes('google-oauth-client-secret-999'), 'No raw OAuth secret in audit log');
      assert(!detailsStr.includes('push-auth-secret-key-777'), 'No raw push auth key in audit log');
      assert(!detailsStr.includes('secret-cookie-value'), 'No raw cookie in audit log');
    }

    console.log('\n--- SECTION 8: Slug / Non-UUID Target ID Handling ---');
    {
      await spawnRepo.save(createTestSpawn('spawn-omega', 'SPWN-OMEGA'));

      // Target ID is a non-UUID slug ('spawn-omega')
      const resSlug = await request(
        baseUrl,
        'PATCH',
        '/api/v1/admin/spawns/spawn-omega/toggle',
        { Authorization: `Bearer ${adminToken}` },
        { enabled: false }
      );
      assert(resSlug.status === 200, 'Mutation with slug succeeded');

      await new Promise((r) => setTimeout(r, 200));

      const slugLogs = await auditService.queryLogs({ action: 'SPAWN_TOGGLE', limit: 2 });
      const slugLog = slugLogs[0];
      assert(slugLog.targetId === null, 'target_id column remains NULL for non-UUID slug');
      assert(slugLog.details.targetIdentifier === 'spawn-omega', 'Non-UUID slug preserved in details.targetIdentifier');
    }

    console.log('\n--- SECTION 9: All 13 Admin Routes Authorization Coverage Matrix ---');
    {
      await spawnRepo.save(createTestSpawn('e5b6c890-0000-0000-0000-000000000001', 'SPWN-TEST-01'));

      const endpoints: Array<{ method: string; path: string; isMutation: boolean }> = [
        { method: 'GET', path: '/api/v1/admin/overview', isMutation: false },
        { method: 'POST', path: '/api/v1/admin/spawns', isMutation: true },
        { method: 'PUT', path: '/api/v1/admin/spawns/e5b6c890-0000-0000-0000-000000000001', isMutation: true },
        { method: 'PATCH', path: '/api/v1/admin/spawns/e5b6c890-0000-0000-0000-000000000001', isMutation: true },
        { method: 'PATCH', path: '/api/v1/admin/spawns/e5b6c890-0000-0000-0000-000000000001/toggle', isMutation: true },
        { method: 'GET', path: '/api/v1/admin/rotation/config', isMutation: false },
        { method: 'PUT', path: '/api/v1/admin/rotation/config', isMutation: true },
        { method: 'POST', path: '/api/v1/admin/rotate', isMutation: true },
        { method: 'GET', path: '/api/v1/admin/cycles/config', isMutation: false },
        { method: 'PUT', path: '/api/v1/admin/cycles/config', isMutation: true },
        { method: 'POST', path: '/api/v1/admin/cycles/reset', isMutation: true },
        { method: 'GET', path: '/api/v1/admin/settings', isMutation: false },
        { method: 'PUT', path: '/api/v1/admin/settings', isMutation: true },
      ];

      for (const ep of endpoints) {
        // 1. Unauthenticated test -> 401
        const unauthRes = await request(baseUrl, ep.method, ep.path, {}, ep.isMutation ? { enabled: true } : undefined);
        assert(unauthRes.status === 401, `[Unauth] ${ep.method} ${ep.path} rejected with 401`);

        // 2. Student test -> 403
        const studentRes = await request(
          baseUrl,
          ep.method,
          ep.path,
          { Authorization: `Bearer ${studentToken}` },
          ep.isMutation ? { enabled: true } : undefined
        );
        assert(studentRes.status === 403, `[Student] ${ep.method} ${ep.path} rejected with 403`);

        // 3. Admin test -> 200 or 201
        const adminRes = await request(
          baseUrl,
          ep.method,
          ep.path,
          { Authorization: `Bearer ${adminToken}` },
          ep.isMutation ? { enabled: true } : undefined
        );
        assert(
          adminRes.status === 200 || adminRes.status === 201,
          `[Admin] ${ep.method} ${ep.path} authorized with ${adminRes.status}`
        );
      }
    }

    console.log('\n--- SECTION 10: Information Leakage Verification ---');
    {
      const forbiddenRes = await request(
        baseUrl,
        'POST',
        '/api/v1/admin/settings',
        { Authorization: `Bearer ${studentToken}` },
        { key: 'test' }
      );
      const bodyStr = JSON.stringify(forbiddenRes.body);
      assert(!bodyStr.includes('stack'), 'No stack trace in 403 response');
      assert(!bodyStr.includes('SELECT'), 'No SQL queries in 403 response');
      assert(!bodyStr.includes('password'), 'No passwords in 403 response');
      assert(!bodyStr.includes('jwt'), 'No token secrets in 403 response');
    }

    console.log('\n================================================================');
    console.log('  🎉 ALL AUTHORIZATION & AUDIT SECURITY TESTS PASSED PERFECTLY!');
    console.log('================================================================\n');

  } finally {
    server.close();
    await dbPool.shutdown();
  }
}

runAuditSecuritySuite().catch((err) => {
  console.error('\n❌ Suite execution failed with error:', err);
  process.exit(1);
});
