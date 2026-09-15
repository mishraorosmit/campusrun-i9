import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { ClaimSpawnUseCase } from '../services/ClaimSpawnUseCase';
import { RotateSpawnsUseCase } from '../services/RotateSpawnsUseCase';
import { AdminManageSpawnsUseCase } from '../services/AdminManageSpawnsUseCase';
import { WeeklyCycleService } from '../services/WeeklyCycleService';
import { ResetWeeklyCycleUseCase } from '../services/ResetWeeklyCycleUseCase';
import { InMemoryRealtimeService, RealtimeService } from '../services/RealtimeService';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { Player } from '../domain/entities/Player';
import { Claim } from '../domain/entities/Claim';
import { Rotation } from '../domain/entities/Rotation';
import { WeeklyCycle, WeeklyCycleSettings, WeeklyResetEvent } from '../domain/entities';
import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { IClaimRepository } from '../repositories/IClaimRepository';
import { ILeaderboardRepository } from '../repositories/ILeaderboardRepository';
import { IRotationRepository } from '../repositories/IRotationRepository';
import { IWeeklyCycleRepository, RecordResetEventDTO } from '../repositories/IWeeklyCycleRepository';
import { ITransactionManager, ITransactionContext } from '../repositories/ITransactionManager';
import { IGeofencingService } from '../domain/rules';
import { IEventBus, EventHandler } from '../events/IEventBus';
import { REALTIME_ROOMS } from '../infrastructure/realtime/events';
import { socketManager, initSocketServer } from '../realtime/socketManager';
import { JwtUtils } from '../infrastructure/auth/JwtUtils';
import { config } from '../config';
import { DomainError } from '../errors';

class FakeTransactionManager implements ITransactionManager {
  public shouldFail = false;
  async runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    if (this.shouldFail) {
      throw new Error('Database transaction failed and rolled back');
    }
    const dummyTx: ITransactionContext = {
      query: async <R = Record<string, unknown>>() => ({ rows: [] as R[], rowCount: 1 }),
    };
    return work(dummyTx);
  }
}

class FakeClaimRepository implements IClaimRepository {
  private claimedSet = new Set<string>();
  private claims = new Map<string, Claim>();

  async countBySpawnAndPlayer(spawnId: string, playerId: string): Promise<number> {
    return this.claimedSet.has(`${playerId}:${spawnId}`) ? 1 : 0;
  }

  async saveTx(claim: Claim, _tx: ITransactionContext): Promise<boolean> {
    const key = `${claim.playerId}:${claim.spawnId}`;
    if (this.claimedSet.has(key)) {
      return false;
    }
    this.claimedSet.add(key);
    this.claims.set(claim.id, claim);
    return true;
  }

  async findById(id: string): Promise<Claim | null> {
    return this.claims.get(id) || null;
  }

  async findByPlayerId(playerId: string): Promise<Claim[]> {
    return Array.from(this.claims.values()).filter((c) => c.playerId === playerId);
  }

  async save(claim: Claim): Promise<void> {
    this.claims.set(claim.id, claim);
  }

  async hasClaimed(spawnId: string, playerId: string): Promise<boolean> {
    return this.claimedSet.has(`${playerId}:${spawnId}`);
  }

  async findRecent(): Promise<Claim[]> {
    return Array.from(this.claims.values());
  }
}

class FakeSpawnRepository implements ISpawnRepository {
  public spawns = new Map<string, SpawnPoint>();

  async findById(id: string): Promise<SpawnPoint | null> {
    return this.spawns.get(id) || null;
  }

  async findByCode(code: string): Promise<SpawnPoint | null> {
    return Array.from(this.spawns.values()).find((s) => s.code === code) || null;
  }

  async findActive(): Promise<SpawnPoint[]> {
    return Array.from(this.spawns.values()).filter((s) => s.isActive);
  }

  async findWithinBounds(): Promise<SpawnPoint[]> {
    return Array.from(this.spawns.values());
  }

  async findNearby(): Promise<SpawnPoint[]> {
    return Array.from(this.spawns.values());
  }

  async save(spawn: SpawnPoint): Promise<void> {
    this.spawns.set(spawn.id, spawn);
  }

  async updateStatus(id: string, status: any, isEnabled?: boolean): Promise<void> {
    const spawn = this.spawns.get(id);
    if (spawn) {
      const updated = new SpawnPoint({
        ...spawn.props,
        status: status || spawn.status,
        enabled: isEnabled !== undefined ? isEnabled : spawn.isEnabled,
      });
      this.spawns.set(id, updated);
    }
  }

  async findAll(): Promise<SpawnPoint[]> {
    return Array.from(this.spawns.values());
  }

  async findByZoneId(zoneId: string): Promise<SpawnPoint[]> {
    return Array.from(this.spawns.values()).filter((s) => s.props.zoneId === zoneId);
  }

  async countActive(): Promise<number> {
    return (await this.findActive()).length;
  }

  async findAvailableForBatch(): Promise<SpawnPoint[]> {
    return Array.from(this.spawns.values());
  }

  async create(spawn: SpawnPoint): Promise<SpawnPoint> {
    this.spawns.set(spawn.id, spawn);
    return spawn;
  }

  async update(spawn: SpawnPoint): Promise<SpawnPoint> {
    this.spawns.set(spawn.id, spawn);
    return spawn;
  }
}


class FakePlayerRepository implements IPlayerRepository {
  public players = new Map<string, Player>();

  async findById(id: string): Promise<Player | null> {
    return this.players.get(id) || null;
  }

  async findByEmail(email: string): Promise<Player | null> {
    return Array.from(this.players.values()).find((p) => p.props.email === email) || null;
  }

  async findByUsername(username: string): Promise<Player | null> {
    return Array.from(this.players.values()).find((p) => p.username === username) || null;
  }

  async save(player: Player): Promise<void> {
    this.players.set(player.id, player);
  }

  async updatePoints(playerId: string, points: number): Promise<void> {
    const player = this.players.get(playerId);
    if (player) {
      const updated = new Player({
        ...player.props,
        totalPoints: (player.props.totalPoints || 0) + points,
        seasonPoints: (player.props.seasonPoints || 0) + points,
      });
      this.players.set(playerId, updated);
    }
  }

  async updatePointsTx(playerId: string, points: number, _tx: ITransactionContext): Promise<void> {
    await this.updatePoints(playerId, points);
  }

  async incrementStreak(): Promise<void> {}
}

class FakeLeaderboardRepository implements ILeaderboardRepository {
  public resetCount = 0;
  async recordScore(): Promise<void> {}
  async getWeekly(): Promise<any[]> { return []; }
  async getAllTime(): Promise<any[]> { return []; }
  async getPlayerWeeklyRank(): Promise<number | null> { return 1; }
  async getPlayerAllTimeRank(): Promise<number | null> { return 1; }
  async resetWeekly(): Promise<void> { this.resetCount++; }
  async resetWeeklyTx(): Promise<void> { this.resetCount++; }
}

class FakeRotationRepository implements IRotationRepository {
  public currentRotation: Rotation | null = null;
  async getCurrent(): Promise<Rotation | null> { return this.currentRotation; }
  async save(rotation: Rotation): Promise<void> { this.currentRotation = rotation; }
  async getHistory(): Promise<Rotation[]> { return this.currentRotation ? [this.currentRotation] : []; }
}

class FakeWeeklyCycleRepository implements IWeeklyCycleRepository {
  public activeCycle: WeeklyCycle | null = new WeeklyCycle({
    id: 'cycle_active_01',
    startsAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
    endsAt: new Date(Date.now() + 4 * 24 * 3600 * 1000),
    status: 'active',
    createdAt: new Date(),
  });
  public resetEvents = new Map<string, WeeklyResetEvent>();

  async getActiveCycle(): Promise<WeeklyCycle | null> {
    return this.activeCycle;
  }

  async getActiveCycleTx(_tx: ITransactionContext, _forUpdate?: boolean): Promise<WeeklyCycle | null> {
    return this.activeCycle;
  }

  async createCycle(cycle: { startsAt: Date; endsAt: Date; status: string }): Promise<WeeklyCycle> {
    const newCycle = new WeeklyCycle({
      id: `cycle_${Date.now()}`,
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
      status: cycle.status as any,
      createdAt: new Date(),
    });
    this.activeCycle = newCycle;
    return newCycle;
  }

  async createCycleTx(cycle: { startsAt: Date; endsAt: Date; status: string }, _tx: ITransactionContext): Promise<WeeklyCycle> {
    return this.createCycle(cycle);
  }

  async completeCycleTx(cycleId: string, _tx: ITransactionContext, completedAt: Date = new Date()): Promise<void> {
    if (this.activeCycle && this.activeCycle.id === cycleId) {
      this.activeCycle = new WeeklyCycle({
        ...this.activeCycle.props,
        status: 'completed',
        completedAt,
      });
    }
  }

  async recordResetEventTx(event: RecordResetEventDTO, _tx: ITransactionContext): Promise<boolean> {
    if (this.resetEvents.has(event.resetKey)) {
      return false;
    }
    this.resetEvents.set(
      event.resetKey,
      new WeeklyResetEvent({
        id: `evt_${Date.now()}`,
        cycleId: event.cycleId,
        resetKey: event.resetKey,
        resetType: event.resetType,
        executedAt: event.executedAt || new Date(),
      })
    );
    return true;
  }

  async getResetEventByKey(resetKey: string, _tx?: ITransactionContext): Promise<WeeklyResetEvent | null> {
    return this.resetEvents.get(resetKey) || null;
  }

  async getSettings(): Promise<WeeklyCycleSettings | null> {
    return new WeeklyCycleSettings({
      id: 1,
      resetWeekday: 0,
      resetTimeUtc: '23:59:00',
      updatedAt: new Date(),
    });
  }

  async getSettingsTx(_tx?: ITransactionContext): Promise<WeeklyCycleSettings | null> {
    return this.getSettings();
  }
}

class FakeGeofencingService implements IGeofencingService {
  calculateDistanceMeters(): number { return 10; }
  calculateDistance(): number { return 10; }
  isPointInPolygon(): boolean { return true; }
}

class FakeEventBus implements IEventBus {
  public published: any[] = [];
  async publish(event: any): Promise<void> { this.published.push(event); }
  subscribe<T>(_eventName: string, _handler: EventHandler<T>): () => void {
    return () => {};
  }
  clear(): void {
    this.published = [];
  }
}

function createTestPlayer(overrides: Partial<Player['props']> = {}): Player {
  return new Player({
    id: overrides.id || 'usr_runner_99',
    username: overrides.username || 'SpeedyRunner',
    email: overrides.email || 'runner@campus.edu',
    role: overrides.role || 'player',
    totalPoints: overrides.totalPoints !== undefined ? overrides.totalPoints : 100,
    seasonPoints: overrides.seasonPoints !== undefined ? overrides.seasonPoints : 100,
    rank: overrides.rank !== undefined ? overrides.rank : 1,
    tier: overrides.tier || 'tier1',
    claimsCount: overrides.claimsCount !== undefined ? overrides.claimsCount : 0,
    currentStreakDays: overrides.currentStreakDays !== undefined ? overrides.currentStreakDays : 0,
    createdAt: overrides.createdAt || new Date('2026-09-01T00:00:00.000Z'),
    lastActiveAt: overrides.lastActiveAt || new Date('2026-09-13T00:00:00.000Z'),
  });
}

describe('Game Event & Leaderboard Realtime Broadcasting', () => {
  let spawnRepo: FakeSpawnRepository;
  let playerRepo: FakePlayerRepository;
  let claimRepo: FakeClaimRepository;
  let leaderboardRepo: FakeLeaderboardRepository;
  let rotationRepo: FakeRotationRepository;
  let weeklyCycleRepo: FakeWeeklyCycleRepository;
  let txManager: FakeTransactionManager;
  let geoService: FakeGeofencingService;
  let eventBus: FakeEventBus;
  let realtimeService: InMemoryRealtimeService;

  beforeEach(() => {
    spawnRepo = new FakeSpawnRepository();
    playerRepo = new FakePlayerRepository();
    claimRepo = new FakeClaimRepository();
    leaderboardRepo = new FakeLeaderboardRepository();
    rotationRepo = new FakeRotationRepository();
    weeklyCycleRepo = new FakeWeeklyCycleRepository();
    txManager = new FakeTransactionManager();
    geoService = new FakeGeofencingService();
    eventBus = new FakeEventBus();
    realtimeService = new InMemoryRealtimeService();
  });

  describe('Claim & Leaderboard Events Broadcasting', () => {
    it('broadcasts anonymous claim:success, claim:success_personal, and leaderboard:updated on valid claim', async () => {
      const spawn = new SpawnPoint({
        id: 'sp_lib_01',
        code: 'LIB01',
        title: 'Central Library Steps',
        points: 50,
        tier: 'tier1',
        coordinates: { lat: 12.9716, lng: 77.5946 },
        svgCoordinates: { x: 100, y: 150 },
        claimRadiusMeters: 50,
        claimCount: 0,
        zoneName: 'Central Campus',
        zoneId: 'zone_central',
        status: 'active',
        enabled: true,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });
      await spawnRepo.save(spawn);

      const player = createTestPlayer({
        id: 'usr_runner_99',
        username: 'SpeedyRunner',
        email: 'runner@campus.edu',
        totalPoints: 100,
        seasonPoints: 100,
      });
      await playerRepo.save(player);

      const useCase = new ClaimSpawnUseCase(
        spawnRepo,
        playerRepo,
        claimRepo,
        leaderboardRepo,
        geoService,
        eventBus,
        txManager,
        realtimeService
      );

      const result = await useCase.execute({
        spawnId: 'sp_lib_01',
        playerId: 'usr_runner_99',
        playerCoordinates: { lat: 12.9716, lng: 77.5946 },
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.pointsAwarded, 50);

      // Verify realtime emissions: claim:success, claim:success_personal, leaderboard:updated
      assert.strictEqual(realtimeService.emittedEvents.length, 3);

      // 1. Check campus_global anonymous broadcast (NO PII)
      const globalEvent = realtimeService.emittedEvents.find((e) => e.event === 'claim:success');
      assert.ok(globalEvent, 'claim:success event should be emitted');
      assert.strictEqual(globalEvent.room, REALTIME_ROOMS.GLOBAL);
      assert.strictEqual(globalEvent.payload.spawnId, 'sp_lib_01');
      assert.strictEqual(globalEvent.payload.spawnCode, 'LIB01');
      assert.strictEqual(globalEvent.payload.pointsAwarded, 50);
      assert.strictEqual(globalEvent.payload.zoneName, 'Central Campus');
      assert.ok(globalEvent.payload.timestamp);
      assert.strictEqual((globalEvent.payload as any).playerId, undefined, 'Global claim broadcast MUST NOT contain playerId');

      // 2. Check user:<userId> personal receipt emission
      const personalEvent = realtimeService.emittedEvents.find((e) => e.event === 'claim:success_personal');
      assert.ok(personalEvent, 'claim:success_personal event should be emitted');
      assert.strictEqual(personalEvent.room, REALTIME_ROOMS.USER('usr_runner_99'));
      assert.strictEqual(personalEvent.payload.playerId, 'usr_runner_99');
      assert.strictEqual(personalEvent.payload.newTotalPoints, 150);
      assert.strictEqual(personalEvent.payload.newSeasonPoints, 150);

      // 3. Check leaderboard:updated broadcast (Strictly delta / tick, NO full-state array dump)
      const lbEvent = realtimeService.emittedEvents.find((e) => e.event === 'leaderboard:updated');
      assert.ok(lbEvent, 'leaderboard:updated event should be emitted');
      assert.strictEqual(lbEvent.room, REALTIME_ROOMS.GLOBAL);
      assert.strictEqual(lbEvent.payload.type, 'weekly');
      assert.ok(lbEvent.payload.updatedAt);
      assert.strictEqual(Array.isArray(lbEvent.payload), false, 'Leaderboard update payload MUST NOT be a full-state array dump');
    });

    it('does not emit any realtime event if database transaction fails', async () => {
      const spawn = new SpawnPoint({
        id: 'sp_eng_02',
        code: 'ENG02',
        title: 'Engineering Lab',
        points: 30,
        tier: 'tier1',
        coordinates: { lat: 12.9716, lng: 77.5946 },
        svgCoordinates: { x: 100, y: 150 },
        claimRadiusMeters: 50,
        claimCount: 0,
        zoneName: 'Engineering',
        zoneId: 'zone_eng',
        status: 'active',
        enabled: true,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });
      await spawnRepo.save(spawn);

      const player = createTestPlayer({
        id: 'usr_runner_99',
        username: 'SpeedyRunner',
        email: 'runner@campus.edu',
        totalPoints: 0,
        seasonPoints: 0,
      });
      await playerRepo.save(player);

      txManager.shouldFail = true;

      const useCase = new ClaimSpawnUseCase(
        spawnRepo,
        playerRepo,
        claimRepo,
        leaderboardRepo,
        geoService,
        eventBus,
        txManager,
        realtimeService
      );

      await assert.rejects(
        async () => {
          await useCase.execute({
            spawnId: 'sp_eng_02',
            playerId: 'usr_runner_99',
            playerCoordinates: { lat: 12.9716, lng: 77.5946 },
          });
        },
        /Database transaction failed/
      );

      // Verify NO events were emitted due to transaction rollback
      assert.strictEqual(realtimeService.emittedEvents.length, 0);
    });
  });

  describe('Weekly Reset Broadcasting (leaderboard:weekly_reset)', () => {
    it('broadcasts leaderboard:weekly_reset and cycle:reset to campus_global upon successful weekly cycle reset', async () => {
      const cycleService = new WeeklyCycleService(
        weeklyCycleRepo,
        leaderboardRepo,
        txManager,
        realtimeService
      );

      const resetUseCase = new ResetWeeklyCycleUseCase(cycleService);

      const result = await resetUseCase.execute({
        resetKey: 'manual:reset_test_01',
        resetType: 'manual',
        triggeredByProfileId: 'admin_usr_01',
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.duplicate, false);

      // Verify realtime emission
      const resetEvent = realtimeService.emittedEvents.find((e) => e.event === 'leaderboard:weekly_reset');
      assert.ok(resetEvent, 'leaderboard:weekly_reset event should be emitted');
      assert.strictEqual(resetEvent.room, REALTIME_ROOMS.GLOBAL);
      assert.strictEqual(resetEvent.payload.resetKey, 'manual:reset_test_01');
      assert.strictEqual(resetEvent.payload.cycleId, 'cycle_active_01');
      assert.ok(resetEvent.payload.nextCycleId);
      assert.ok(resetEvent.payload.nextResetAt);
    });

    it('does not broadcast duplicate leaderboard:weekly_reset events if resetKey was already processed', async () => {
      const cycleService = new WeeklyCycleService(
        weeklyCycleRepo,
        leaderboardRepo,
        txManager,
        realtimeService
      );

      // First reset succeeds
      await cycleService.resetWeeklyCycle({
        resetKey: 'manual:dup_key_01',
        resetType: 'manual',
      });
      assert.strictEqual(realtimeService.emittedEvents.length >= 1, true);

      // Clear events
      realtimeService.clear();

      // Duplicate execution with same key
      const dupResult = await cycleService.resetWeeklyCycle({
        resetKey: 'manual:dup_key_01',
        resetType: 'manual',
      });

      assert.strictEqual(dupResult.duplicate, true);
      // No duplicate broadcast should fire
      assert.strictEqual(realtimeService.emittedEvents.length, 0);
    });
  });

  describe('Rotation and Batch Spawn Events Broadcasting', () => {
    it('broadcasts spawn:batch_created and rotation:manual to campus_global on manual rotation', async () => {
      const spawn1 = new SpawnPoint({
        id: 'sp_01',
        code: 'SP01',
        title: 'Quad Fountain',
        points: 40,
        tier: 'tier2',
        coordinates: { lat: 12.97, lng: 77.59 },
        svgCoordinates: { x: 100, y: 150 },
        claimRadiusMeters: 30,
        claimCount: 0,
        zoneName: 'Central Campus',
        zoneId: 'zone_central',
        status: 'active',
        enabled: true,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });
      await spawnRepo.save(spawn1);

      const rotateUseCase = new RotateSpawnsUseCase(
        rotationRepo,
        spawnRepo,
        eventBus,
        { rotationIntervalMinutes: 30, concurrentActiveSpawns: 5 },
        realtimeService
      );

      const res = await rotateUseCase.execute('admin_master_1');
      assert.strictEqual(res.rotationNumber, 1);

      // Verify broadcast events
      assert.strictEqual(realtimeService.emittedEvents.length, 2);

      // 1. Check spawn:batch_created
      const batchEvent = realtimeService.emittedEvents.find((e) => e.event === 'spawn:batch_created');
      assert.ok(batchEvent, 'spawn:batch_created event must be broadcasted');
      assert.strictEqual(batchEvent.room, REALTIME_ROOMS.GLOBAL);
      assert.strictEqual(batchEvent.payload.rotationNumber, 1);
      assert.strictEqual(batchEvent.payload.spawns.length, 1);
      assert.strictEqual(batchEvent.payload.spawns[0].id, 'sp_01');
      assert.strictEqual(batchEvent.payload.spawns[0].points, 40);

      // 2. Check rotation:manual
      const rotEvent = realtimeService.emittedEvents.find((e) => e.event === 'rotation:manual');
      assert.ok(rotEvent, 'rotation:manual event must be broadcasted');
      assert.strictEqual(rotEvent.room, REALTIME_ROOMS.GLOBAL);
      assert.strictEqual(rotEvent.payload.adminId, 'admin_master_1');
      assert.strictEqual(rotEvent.payload.rotationNumber, 1);
      assert.strictEqual(rotEvent.payload.activeSpawnsCount, 1);
    });

    it('broadcasts spawn:expired when admin disables a spawn', async () => {
      const spawn = new SpawnPoint({
        id: 'sp_admin_disable',
        code: 'AD01',
        title: 'Restricted Tower',
        points: 100,
        tier: 'tier3',
        coordinates: { lat: 12.97, lng: 77.59 },
        svgCoordinates: { x: 100, y: 150 },
        claimRadiusMeters: 25,
        claimCount: 0,
        zoneName: 'Central Campus',
        zoneId: 'zone_central',
        status: 'active',
        enabled: true,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });
      await spawnRepo.save(spawn);

      const adminUseCase = new AdminManageSpawnsUseCase(spawnRepo, realtimeService);

      const result = await adminUseCase.toggleSpawn('sp_admin_disable', false);
      assert.strictEqual(result.enabled, false);

      assert.strictEqual(realtimeService.emittedEvents.length, 1);
      const expiredEvent = realtimeService.emittedEvents[0];
      assert.strictEqual(expiredEvent.event, 'spawn:expired');
      assert.strictEqual(expiredEvent.room, REALTIME_ROOMS.GLOBAL);
      assert.deepStrictEqual(expiredEvent.payload.spawnIds, ['sp_admin_disable']);
      assert.strictEqual(expiredEvent.payload.reason, 'DISABLED');
    });
  });

  describe('Client Reconnect & Lightweight Sync Signal (reconnect:sync_required)', () => {
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      server = http.createServer();
      initSocketServer(server);
      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            port = addr.port;
          }
          resolve();
        });
      });
    });

    afterEach(async () => {
      await socketManager.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('emits reconnect:sync_required upon client connection without heavy full-state dumps', async () => {
      const token = JwtUtils.sign(
        {
          sub: 'player_reconnect_01',
          email: 'reconnect@campus.edu',
          username: 'ReconnectPlayer',
          role: 'STUDENT',
        },
        config.JWT_SECRET,
        3600
      );

      const client: ClientSocketType = ClientSocket(`http://localhost:${port}`, {
        auth: { token },
        transports: ['websocket'],
      });

      const syncPayload = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('reconnect:sync_required event timed out')), 4000);
        client.on('reconnect:sync_required', (payload) => {
          clearTimeout(timeout);
          resolve(payload);
        });
      });

      assert.ok(syncPayload, 'reconnect:sync_required payload should be received');
      assert.ok(syncPayload.last_updated_timestamp, 'Must include last_updated_timestamp');
      assert.ok(syncPayload.serverTime, 'Must include serverTime');

      // CRITICAL: Ensure NO massive full state dump is present in the reconnect signal
      assert.strictEqual((syncPayload as any).spawns, undefined, 'Must not dump all spawns');
      assert.strictEqual((syncPayload as any).leaderboard, undefined, 'Must not dump entire leaderboard');
      assert.strictEqual((syncPayload as any).claims, undefined, 'Must not dump all claims');

      client.disconnect();
    });

    it('responds with lightweight sync signal when client requests reconnect:sync', async () => {
      const token = JwtUtils.sign(
        {
          sub: 'player_reconnect_02',
          email: 'reconnect2@campus.edu',
          username: 'ReconnectPlayer2',
          role: 'STUDENT',
        },
        config.JWT_SECRET,
        3600
      );

      const client: ClientSocketType = ClientSocket(`http://localhost:${port}`, {
        auth: { token },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        client.on('connect', () => resolve());
      });

      const response = await new Promise<any>((resolve) => {
        client.emit('reconnect:sync', (ackData: any) => {
          resolve(ackData);
        });
      });

      assert.ok(response);
      assert.ok(response.last_updated_timestamp);
      assert.ok(response.serverTime);

      client.disconnect();
    });
  });

  describe('RealtimeService Fire-and-Forget Safety', () => {
    it('does not throw or block execution even if Socket.IO server throws an unexpected error', async () => {
      const brokenIo = {
        to: () => {
          throw new Error('Socket.IO internal engine failure');
        },
      } as any;

      const brokenRealtimeService = new RealtimeService(() => brokenIo);

      // Verify none of these throw
      assert.doesNotThrow(() => {
        brokenRealtimeService.broadcastSpawnBatchCreated({ spawns: [], timestamp: new Date().toISOString() });
        brokenRealtimeService.broadcastPublicClaim({ spawnId: 'sp_1', pointsAwarded: 10, timestamp: new Date().toISOString() });
        brokenRealtimeService.broadcastLeaderboardUpdated({ type: 'weekly', updatedAt: new Date().toISOString() });
        brokenRealtimeService.broadcastLeaderboardWeeklyReset({
          cycleId: 'c_1',
          resetKey: 'key_1',
          executedAt: new Date().toISOString(),
          nextResetAt: new Date().toISOString(),
        });
        brokenRealtimeService.emitReconnectSyncRequired('usr_1', {
          last_updated_timestamp: new Date().toISOString(),
          serverTime: new Date().toISOString(),
        });
      });
    });
  });
});
