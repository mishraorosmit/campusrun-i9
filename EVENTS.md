# Project I9 — Internal Domain Events & Contracts

This document defines the asynchronous internal domain event system, event contract interfaces, payloads, and subscriber architecture.

---

## 1. Overview & Architecture

Project I9 utilizes an internal **Domain Event Bus** (`IEventBus`) to decouple primary game transactions (e.g. claiming a spawn point, rotating spawn pools) from secondary side-effects (e.g. updating leaderboard standings, triggering notifications, updating zone counts, or streaming realtime WebSocket events).

- **Execution Mode:** In-memory asynchronous dispatch (`InMemoryEventBus`).
- **Isolation:** Event publication does not fail the primary transaction if a subscriber encounters an error.
- **Future Ready:** The `IEventBus` interface is designed to seamlessly swap to Redis Streams or RabbitMQ when scaling horizontally across multi-instance clusters.

---

## 2. Base Event Contract

All domain events implement the `IDomainEvent<T>` interface:

```typescript
export interface IDomainEvent<T = unknown> {
  readonly eventId: string;       // Unique event identifier (e.g. evt_1726162512_abc)
  readonly eventName: string;     // Machine-readable uppercase event name
  readonly occurredAt: Date;      // Timestamp when the event happened
  readonly payload: T;            // Strongly typed payload contract
}
```

---

## 3. Catalog of Domain Events

### 3.1 `SPAWN_CLAIMED`
Emitted immediately after a player successfully claims a spawn point within valid geofencing radius.

* **Class:** `SpawnClaimedEvent`
* **Payload Contract (`SpawnClaimedPayload`):**
  ```typescript
  export interface SpawnClaimedPayload {
    claimId: string;
    spawnId: string;
    spawnCode: string;
    playerId: string;
    pointsAwarded: number;
    playerLat: number;
    playerLng: number;
    zoneId: string;
  }
  ```
* **Subscribers:**
  - `LeaderboardService`: Recalculates weekly and all-time scores for the player.
  - `NotificationService`: Sends claim confirmation push alerts.
  - `AnalyticsService`: Records claim density and geospatial heatmap point.

---

### 3.2 `ROTATION_TRIGGERED`
Emitted whenever a scheduled or admin-forced spawn rotation cycle occurs.

* **Class:** `RotationTriggeredEvent`
* **Payload Contract (`RotationTriggeredPayload`):**
  ```typescript
  export interface RotationTriggeredPayload {
    rotationId: string;
    rotationNumber: number;
    activatedSpawnCount: number;
    expiresAt: Date;
  }
  ```
* **Subscribers:**
  - `MapCacheService`: Invalidates cached spawn point clusters.
  - `NotificationService`: Alerts active campus players of fresh spawn nodes.

---

### 3.3 `PLAYER_STREAK_UPDATED`
Emitted when a player maintains or increments their consecutive daily active claim streak.

* **Class:** `PlayerStreakUpdatedEvent`
* **Payload Contract (`PlayerStreakUpdatedPayload`):**
  ```typescript
  export interface PlayerStreakUpdatedPayload {
    playerId: string;
    previousStreak: number;
    currentStreak: number;
    totalPoints: number;
  }
  ```
* **Subscribers:**
  - `AchievementService`: Checks badge eligibility for streak milestones.
  - `NotificationService`: Alerts player of streak preservation.

---

### 3.4 `LEADERBOARD_RESET`
Emitted when the weekly competitive leaderboard cycle resets (e.g. Sunday 11:59 PM).

* **Class:** `LeaderboardResetEvent`
* **Payload Contract (`LeaderboardResetPayload`):**
  ```typescript
  export interface LeaderboardResetPayload {
    resetTimestamp: Date;
    period: 'weekly' | 'season';
  }
  ```
* **Subscribers:**
  - `LeaderboardService`: Resets weekly score tallies.
  - `ArchiveService`: Snapshots winner podium and historical season records.

---

## 4. Subscribing to Events

```typescript
import { eventBus } from './events';
import { SpawnClaimedEvent } from './domain/events';

// Subscribe to SPAWN_CLAIMED
const unsubscribe = eventBus.subscribe<SpawnClaimedPayload>('SPAWN_CLAIMED', async (event) => {
  console.log(`Player ${event.payload.playerId} claimed ${event.payload.pointsAwarded} points!`);
});

// To unsubscribe later:
// unsubscribe();
```
