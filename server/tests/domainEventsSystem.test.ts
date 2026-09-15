import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  RotationTriggeredEvent,
  SpawnRotatedEvent,
  SpawnExpiredEvent,
  SpawnClaimedEvent,
  ClaimSuccessEvent,
  RankChangedEvent,
  ResetApproachingEvent,
  LeaderboardResetEvent,
  WeeklyResetDomainEvent,
  PlayerStreakUpdatedEvent,
  DOMAIN_EVENT_NAMES,
} from '../domain/events';
import { InMemoryEventBus } from '../events/EventBus';

describe('Domain Events System & 6 Logical Events', () => {
  let eventBus: InMemoryEventBus;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
  });

  it('1. SPAWN_ROTATED / RotationTriggeredEvent can be published and handled', async () => {
    let receivedPayload: any = null;

    eventBus.subscribe(DOMAIN_EVENT_NAMES.SPAWN_ROTATED, async (event) => {
      receivedPayload = event.payload;
    });

    const event = new SpawnRotatedEvent({
      rotationId: 'rot_01',
      rotationNumber: 5,
      activatedSpawnCount: 10,
      expiresAt: new Date(Date.now() + 1800 * 1000),
    });

    assert.strictEqual(event.eventName, 'ROTATION_TRIGGERED');
    assert.ok(event.eventId.startsWith('evt_'));
    assert.ok(event.occurredAt instanceof Date);

    await eventBus.publish(event);

    assert.ok(receivedPayload);
    assert.strictEqual(receivedPayload.rotationId, 'rot_01');
    assert.strictEqual(receivedPayload.rotationNumber, 5);
  });

  it('2. SPAWN_EXPIRED / SpawnExpiredEvent can be published and handled', async () => {
    let receivedPayload: any = null;

    eventBus.subscribe(DOMAIN_EVENT_NAMES.SPAWN_EXPIRED, async (event) => {
      receivedPayload = event.payload;
    });

    const event = new SpawnExpiredEvent({
      spawnIds: ['sp_01', 'sp_02'],
      spawnId: 'sp_01',
      spawnCode: 'LIB01',
      zoneId: 'zone_north',
      reason: 'WINDOW_EXPIRED',
      expiredAt: new Date(),
    });

    assert.strictEqual(event.eventName, 'SPAWN_EXPIRED');
    assert.ok(event.eventId.startsWith('evt_'));

    await eventBus.publish(event);

    assert.ok(receivedPayload);
    assert.deepStrictEqual(receivedPayload.spawnIds, ['sp_01', 'sp_02']);
    assert.strictEqual(receivedPayload.reason, 'WINDOW_EXPIRED');
  });

  it('3. CLAIM_SUCCESS / SpawnClaimedEvent can be published and handled', async () => {
    let receivedPayload: any = null;

    eventBus.subscribe(DOMAIN_EVENT_NAMES.CLAIM_SUCCESS, async (event) => {
      receivedPayload = event.payload;
    });

    const event = new ClaimSuccessEvent({
      claimId: 'cl_01',
      spawnId: 'sp_01',
      spawnCode: 'LIB01',
      playerId: 'usr_01',
      pointsAwarded: 50,
      playerLat: 12.97,
      playerLng: 77.59,
      zoneId: 'zone_central',
    });

    assert.strictEqual(event.eventName, 'SPAWN_CLAIMED');
    assert.ok(event.eventId.startsWith('evt_'));

    await eventBus.publish(event);

    assert.ok(receivedPayload);
    assert.strictEqual(receivedPayload.claimId, 'cl_01');
    assert.strictEqual(receivedPayload.pointsAwarded, 50);
  });

  it('4. RANK_CHANGED / RankChangedEvent can be published and handled', async () => {
    let receivedPayload: any = null;

    eventBus.subscribe(DOMAIN_EVENT_NAMES.RANK_CHANGED, async (event) => {
      receivedPayload = event.payload;
    });

    const event = new RankChangedEvent({
      playerId: 'usr_top_01',
      username: 'FastRunner',
      oldRank: 3,
      newRank: 1,
      points: 450,
      period: 'weekly',
      timestamp: new Date(),
    });

    assert.strictEqual(event.eventName, 'RANK_CHANGED');
    assert.ok(event.eventId.startsWith('evt_'));

    await eventBus.publish(event);

    assert.ok(receivedPayload);
    assert.strictEqual(receivedPayload.playerId, 'usr_top_01');
    assert.strictEqual(receivedPayload.oldRank, 3);
    assert.strictEqual(receivedPayload.newRank, 1);
  });

  it('5. RESET_APPROACHING / ResetApproachingEvent can be published and handled', async () => {
    let receivedPayload: any = null;

    eventBus.subscribe(DOMAIN_EVENT_NAMES.RESET_APPROACHING, async (event) => {
      receivedPayload = event.payload;
    });

    const event = new ResetApproachingEvent({
      cycleId: 'cycle_week_37',
      endsAt: new Date(Date.now() + 15 * 60 * 1000),
      minutesRemaining: 15,
      timestamp: new Date(),
    });

    assert.strictEqual(event.eventName, 'RESET_APPROACHING');
    assert.ok(event.eventId.startsWith('evt_'));

    await eventBus.publish(event);

    assert.ok(receivedPayload);
    assert.strictEqual(receivedPayload.cycleId, 'cycle_week_37');
    assert.strictEqual(receivedPayload.minutesRemaining, 15);
  });

  it('6. WEEKLY_RESET / LeaderboardResetEvent can be published and handled', async () => {
    let receivedPayload: any = null;

    eventBus.subscribe(DOMAIN_EVENT_NAMES.WEEKLY_RESET, async (event) => {
      receivedPayload = event.payload;
    });

    const event = new WeeklyResetDomainEvent({
      cycleId: 'cycle_01',
      resetKey: 'manual:cycle_01',
      resetTimestamp: new Date(),
      period: 'weekly',
    });

    assert.strictEqual(event.eventName, 'LEADERBOARD_RESET');
    assert.ok(event.eventId.startsWith('evt_'));

    await eventBus.publish(event);

    assert.ok(receivedPayload);
    assert.strictEqual(receivedPayload.cycleId, 'cycle_01');
    assert.strictEqual(receivedPayload.period, 'weekly');
  });

  it('Existing PlayerStreakUpdatedEvent remains fully functional', async () => {
    let handled = false;

    eventBus.subscribe('PLAYER_STREAK_UPDATED', async () => {
      handled = true;
    });

    const event = new PlayerStreakUpdatedEvent({
      playerId: 'usr_01',
      previousStreak: 3,
      currentStreak: 4,
      totalPoints: 200,
    });

    await eventBus.publish(event);
    assert.strictEqual(handled, true);
  });
});

describe('Use-Case Domain Event Wiring & Fault Tolerance', () => {
  let eventBus: InMemoryEventBus;
  let publishedEvents: any[];

  beforeEach(() => {
    publishedEvents = [];
    eventBus = new InMemoryEventBus();
    // Intercept all publishes for testing
    const originalPublish = eventBus.publish.bind(eventBus);
    eventBus.publish = async (event: any) => {
      publishedEvents.push(event);
      return originalPublish(event);
    };
  });

  it('RotateSpawnsUseCase emits RotationTriggeredEvent after rotation is saved', async () => {
    const { RotateSpawnsUseCase } = await import('../services/RotateSpawnsUseCase');
    const { Rotation } = await import('../domain/entities/Rotation');

    const fakeRotationRepo: any = {
      getCurrent: async () => null,
      save: async () => {},
    };
    const fakeSpawnRepo: any = {
      findActive: async () => [],
    };

    const useCase = new RotateSpawnsUseCase(
      fakeRotationRepo,
      fakeSpawnRepo,
      eventBus,
      { rotationIntervalMinutes: 30, concurrentActiveSpawns: 5 }
    );

    const result = await useCase.execute('admin_test');
    assert.strictEqual(result.rotationNumber, 1);

    const rotationEvent = publishedEvents.find((e) => e.eventName === 'ROTATION_TRIGGERED');
    assert.ok(rotationEvent, 'RotationTriggeredEvent should be emitted');
    assert.strictEqual(rotationEvent.payload.rotationNumber, 1);
    assert.strictEqual(rotationEvent.payload.activatedSpawnCount, 5);
  });

  it('AdminManageSpawnsUseCase emits SpawnExpiredEvent when disabling a spawn', async () => {
    const { AdminManageSpawnsUseCase } = await import('../services/AdminManageSpawnsUseCase');
    const { SpawnPoint } = await import('../domain/entities/SpawnPoint');

    const testSpawn = new SpawnPoint({
      id: 'spawn_test_01',
      code: 'TEST01',
      title: 'Test Spawn',
      points: 20,
      tier: 'tier1',
      coordinates: { lat: 10, lng: 20 },
      svgCoordinates: { x: 50, y: 50 },
      claimRadiusMeters: 30,
      claimCount: 0,
      zoneName: 'Test Zone',
      zoneId: 'zone_01',
      status: 'active',
      enabled: true,
      expiresAt: new Date(Date.now() + 3600000),
    });

    const fakeSpawnRepo: any = {
      findById: async () => testSpawn,
      updateStatus: async () => {},
    };

    const useCase = new AdminManageSpawnsUseCase(fakeSpawnRepo, undefined, eventBus);
    const res = await useCase.toggleSpawn('spawn_test_01', false);
    assert.strictEqual(res.enabled, false);

    const expiredEvent = publishedEvents.find((e) => e.eventName === 'SPAWN_EXPIRED');
    assert.ok(expiredEvent, 'SpawnExpiredEvent should be emitted');
    assert.deepStrictEqual(expiredEvent.payload.spawnIds, ['spawn_test_01']);
    assert.strictEqual(expiredEvent.payload.spawnCode, 'TEST01');
    assert.strictEqual(expiredEvent.payload.reason, 'DISABLED');
  });

  it('ClaimSpawnUseCase emits SpawnClaimedEvent and RankChangedEvent post-commit', async () => {
    const { ClaimSpawnUseCase } = await import('../services/ClaimSpawnUseCase');
    const { SpawnPoint } = await import('../domain/entities/SpawnPoint');
    const { Player } = await import('../domain/entities/Player');

    const spawn = new SpawnPoint({
      id: 'sp_claim_01',
      code: 'CLM01',
      title: 'Claimable Spot',
      points: 40,
      tier: 'tier1',
      coordinates: { lat: 12.97, lng: 77.59 },
      svgCoordinates: { x: 10, y: 10 },
      claimRadiusMeters: 50,
      claimCount: 0,
      zoneName: 'Zone A',
      zoneId: 'zone_a',
      status: 'active',
      enabled: true,
      expiresAt: new Date(Date.now() + 3600000),
    });

    const player = new Player({
      id: 'usr_clm_01',
      username: 'FastClaimer',
      email: 'claimer@campus.edu',
      role: 'player',
      totalPoints: 100,
      seasonPoints: 100,
      rank: 5,
      tier: 'tier1',
      claimsCount: 2,
      currentStreakDays: 1,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });

    const fakeSpawnRepo: any = { findById: async () => spawn };
    const fakePlayerRepo: any = {
      findById: async () => player,
      updatePointsTx: async () => {},
    };
    const fakeClaimRepo: any = {
      countBySpawnAndPlayer: async () => 0,
      saveTx: async () => true,
    };
    const fakeLeaderboardRepo: any = {
      recordScore: async () => {},
      getPlayerWeeklyRank: async () => 2, // rank changed from 5 to 2
    };
    const fakeGeo: any = {
      calculateDistanceMeters: () => 10,
    };
    const fakeTxManager: any = {
      runInTransaction: async (work: any) => work({}),
    };

    const useCase = new ClaimSpawnUseCase(
      fakeSpawnRepo,
      fakePlayerRepo,
      fakeClaimRepo,
      fakeLeaderboardRepo,
      fakeGeo,
      eventBus,
      fakeTxManager
    );

    const result = await useCase.execute({
      spawnId: 'sp_claim_01',
      playerId: 'usr_clm_01',
      playerCoordinates: { lat: 12.97, lng: 77.59 },
    });

    assert.strictEqual(result.success, true);

    const claimEvent = publishedEvents.find((e) => e.eventName === 'SPAWN_CLAIMED');
    assert.ok(claimEvent, 'SpawnClaimedEvent must be published');
    assert.strictEqual(claimEvent.payload.spawnId, 'sp_claim_01');
    assert.strictEqual(claimEvent.payload.playerId, 'usr_clm_01');
    assert.strictEqual(claimEvent.payload.pointsAwarded, 40);

    const rankEvent = publishedEvents.find((e) => e.eventName === 'RANK_CHANGED');
    assert.ok(rankEvent, 'RankChangedEvent must be published on rank change');
    assert.strictEqual(rankEvent.payload.playerId, 'usr_clm_01');
    assert.strictEqual(rankEvent.payload.oldRank, 5);
    assert.strictEqual(rankEvent.payload.newRank, 2);
  });

  it('WeeklyCycleService emits LeaderboardResetEvent post-commit and ResetApproachingEvent when near reset', async () => {
    const { WeeklyCycleService } = await import('../services/WeeklyCycleService');
    const { WeeklyCycle, WeeklyCycleSettings } = await import('../domain/entities');

    const activeCycle = new WeeklyCycle({
      id: 'cycle_active_99',
      startsAt: new Date(Date.now() - 6 * 24 * 3600 * 1000),
      endsAt: new Date(Date.now() + 20 * 60 * 1000), // 20 minutes remaining (< 60m)
      status: 'active',
      createdAt: new Date(),
    });

    const fakeWeeklyCycleRepo: any = {
      getActiveCycle: async () => activeCycle,
      getActiveCycleTx: async () => activeCycle,
      getResetEventByKey: async () => null,
      recordResetEventTx: async () => true,
      completeCycleTx: async () => {},
      getSettingsTx: async () => new WeeklyCycleSettings({ id: 1, resetWeekday: 0, resetTimeUtc: '23:59:00', updatedAt: new Date() }),
      createCycleTx: async (c: any) => new WeeklyCycle({ id: 'cycle_next_100', ...c, createdAt: new Date() }),
    };
    const fakeLeaderboardRepo: any = {
      resetWeeklyTx: async () => {},
    };
    const fakeTxManager: any = {
      runInTransaction: async (work: any) => work({}),
    };

    const cycleService = new WeeklyCycleService(
      fakeWeeklyCycleRepo,
      fakeLeaderboardRepo,
      fakeTxManager,
      undefined,
      eventBus
    );

    // 1. Check getNextResetTimestamp emits ResetApproachingEvent
    const nextReset = await cycleService.getNextResetTimestamp();
    assert.strictEqual(nextReset.cycleId, 'cycle_active_99');

    const approachingEvent = publishedEvents.find((e) => e.eventName === 'RESET_APPROACHING');
    assert.ok(approachingEvent, 'ResetApproachingEvent must be published when minutesRemaining <= 60');
    assert.strictEqual(approachingEvent.payload.cycleId, 'cycle_active_99');
    assert.ok(approachingEvent.payload.minutesRemaining <= 60);

    // 2. Check resetWeeklyCycle emits LeaderboardResetEvent
    const resetRes = await cycleService.resetWeeklyCycle({
      resetKey: 'manual:test_event_reset',
      resetType: 'manual',
    });
    assert.strictEqual(resetRes.success, true);
    assert.strictEqual(resetRes.duplicate, false);

    const resetEvent = publishedEvents.find((e) => e.eventName === 'LEADERBOARD_RESET');
    assert.ok(resetEvent, 'LeaderboardResetEvent must be published post-commit');
    assert.strictEqual(resetEvent.payload.resetKey, 'manual:test_event_reset');
    assert.strictEqual(resetEvent.payload.cycleId, 'cycle_active_99');
  });

  it('EventBus publish failure does NOT break or roll back use cases', async () => {
    const brokenEventBus: InMemoryEventBus = {
      publish: async () => {
        throw new Error('Event bus internal worker exploded');
      },
      subscribe: () => () => {},
      clear: () => {},
    } as any;

    const { RotateSpawnsUseCase } = await import('../services/RotateSpawnsUseCase');
    const { AdminManageSpawnsUseCase } = await import('../services/AdminManageSpawnsUseCase');
    const { WeeklyCycleService } = await import('../services/WeeklyCycleService');
    const { SpawnPoint } = await import('../domain/entities/SpawnPoint');
    const { WeeklyCycle, WeeklyCycleSettings } = await import('../domain/entities');

    // 1. RotateSpawnsUseCase with broken event bus
    const rotateUseCase = new RotateSpawnsUseCase(
      { getCurrent: async () => null, save: async () => {} } as any,
      { findActive: async () => [] } as any,
      brokenEventBus,
      { rotationIntervalMinutes: 30, concurrentActiveSpawns: 5 }
    );
    const rotRes = await rotateUseCase.execute();
    assert.strictEqual(rotRes.rotationNumber, 1);

    // 2. AdminManageSpawnsUseCase with broken event bus
    const testSpawn = new SpawnPoint({
      id: 'spawn_err_01',
      code: 'ERR01',
      title: 'Err Spawn',
      points: 20,
      tier: 'tier1',
      coordinates: { lat: 10, lng: 20 },
      svgCoordinates: { x: 50, y: 50 },
      claimRadiusMeters: 30,
      claimCount: 0,
      zoneName: 'Test Zone',
      zoneId: 'zone_01',
      status: 'active',
      enabled: true,
      expiresAt: new Date(Date.now() + 3600000),
    });
    const adminUseCase = new AdminManageSpawnsUseCase(
      { findById: async () => testSpawn, updateStatus: async () => {} } as any,
      undefined,
      brokenEventBus
    );
    const adminRes = await adminUseCase.toggleSpawn('spawn_err_01', false);
    assert.strictEqual(adminRes.enabled, false);

    // 3. WeeklyCycleService with broken event bus
    const activeCycle = new WeeklyCycle({
      id: 'cycle_err_99',
      startsAt: new Date(Date.now() - 6 * 24 * 3600 * 1000),
      endsAt: new Date(Date.now() + 10 * 60 * 1000),
      status: 'active',
      createdAt: new Date(),
    });
    const cycleService = new WeeklyCycleService(
      {
        getActiveCycle: async () => activeCycle,
        getActiveCycleTx: async () => activeCycle,
        getResetEventByKey: async () => null,
        recordResetEventTx: async () => true,
        completeCycleTx: async () => {},
        getSettingsTx: async () => new WeeklyCycleSettings({ id: 1, resetWeekday: 0, resetTimeUtc: '23:59:00', updatedAt: new Date() }),
        createCycleTx: async (c: any) => new WeeklyCycle({ id: 'cycle_next_err', ...c, createdAt: new Date() }),
      } as any,
      { resetWeeklyTx: async () => {} } as any,
      { runInTransaction: async (w: any) => w({}) } as any,
      undefined,
      brokenEventBus
    );

    const nextResetRes = await cycleService.getNextResetTimestamp();
    assert.strictEqual(nextResetRes.cycleId, 'cycle_err_99');

    const resetRes = await cycleService.resetWeeklyCycle({
      resetKey: 'manual:test_broken_ebus',
      resetType: 'manual',
    });
    assert.strictEqual(resetRes.success, true);
  });
});
