import { IRealtimeService } from './IRealtimeService';
import {
  REALTIME_ROOMS,
  SpawnBatchCreatedPayload,
  SpawnExpiredPayload,
  PublicClaimBroadcastPayload,
  PersonalClaimSuccessPayload,
  RotationManualPayload,
  LeaderboardUpdatedPayload,
  LeaderboardWeeklyResetPayload,
  ReconnectSyncRequiredPayload,
  NotificationReceivedPayload,
  WeeklyResetTriggeredPayload,
} from '../infrastructure/realtime/events';
import { getSocketServer, AppSocketServer } from '../realtime/socketManager';

export class RealtimeService implements IRealtimeService {
  constructor(private readonly getIo: () => AppSocketServer | null = getSocketServer) {}

  public broadcastSpawnBatchCreated(payload: SpawnBatchCreatedPayload): void {
    try {
      const io = this.getIo();
      if (io) {
        io.to(REALTIME_ROOMS.GLOBAL).emit('spawn:batch_created', payload);
      }
    } catch (err) {
      // Fire-and-forget: do not block or throw
    }
  }

  public broadcastSpawnsExpired(payload: SpawnExpiredPayload): void {
    try {
      const io = this.getIo();
      if (io) {
        io.to(REALTIME_ROOMS.GLOBAL).emit('spawn:expired', payload);
      }
    } catch (err) {
      // Fire-and-forget
    }
  }

  public broadcastManualRotation(payload: RotationManualPayload): void {
    try {
      const io = this.getIo();
      if (io) {
        io.to(REALTIME_ROOMS.GLOBAL).emit('rotation:manual', payload);
      }
    } catch (err) {
      // Fire-and-forget
    }
  }

  public broadcastPublicClaim(payload: PublicClaimBroadcastPayload): void {
    try {
      const io = this.getIo();
      if (io) {
        io.to(REALTIME_ROOMS.GLOBAL).emit('claim:success', payload);
      }
    } catch (err) {
      // Fire-and-forget
    }
  }

  public emitPersonalClaimSuccess(userId: string, payload: PersonalClaimSuccessPayload): void {
    try {
      const io = this.getIo();
      if (io) {
        io.to(REALTIME_ROOMS.USER(userId)).emit('claim:success_personal', payload);
      }
    } catch (err) {
      // Fire-and-forget
    }
  }

  public broadcastLeaderboardUpdated(payload: LeaderboardUpdatedPayload): void {
    try {
      const io = this.getIo();
      if (io) {
        io.to(REALTIME_ROOMS.GLOBAL).emit('leaderboard:updated', payload);
      }
    } catch (err) {
      // Fire-and-forget
    }
  }

  public broadcastLeaderboardTick(payload: { updatedAt: string }): void {
    try {
      const io = this.getIo();
      if (io) {
        io.to(REALTIME_ROOMS.GLOBAL).emit('leaderboard:tick', payload);
      }
    } catch (err) {
      // Fire-and-forget
    }
  }

  public broadcastLeaderboardWeeklyReset(payload: LeaderboardWeeklyResetPayload): void {
    try {
      const io = this.getIo();
      if (io) {
        io.to(REALTIME_ROOMS.GLOBAL).emit('leaderboard:weekly_reset', payload);
        io.to(REALTIME_ROOMS.GLOBAL).emit('cycle:reset', payload);
      }
    } catch (err) {
      // Fire-and-forget
    }
  }

  public broadcastWeeklyReset(payload: WeeklyResetTriggeredPayload): void {
    this.broadcastLeaderboardWeeklyReset(payload);
  }

  public emitReconnectSyncRequired(userIdOrSocketId: string, payload: ReconnectSyncRequiredPayload): void {
    try {
      const io = this.getIo();
      if (io) {
        // If it looks like a socket ID, emit directly or to user room
        if (io.sockets.sockets.has(userIdOrSocketId)) {
          io.to(userIdOrSocketId).emit('reconnect:sync_required', payload);
        } else {
          io.to(REALTIME_ROOMS.USER(userIdOrSocketId)).emit('reconnect:sync_required', payload);
        }
      }
    } catch (err) {
      // Fire-and-forget
    }
  }

  public emitNotificationReceived(userId: string, payload: NotificationReceivedPayload): void {
    try {
      const io = this.getIo();
      if (io) {
        io.to(REALTIME_ROOMS.USER(userId)).emit('notification:received', payload);
      }
    } catch (err) {
      // Fire-and-forget
    }
  }
}

/**
 * In-memory test spy for RealtimeService
 */
export class InMemoryRealtimeService implements IRealtimeService {
  public emittedEvents: Array<{ event: string; room?: string; payload: any }> = [];

  public broadcastSpawnBatchCreated(payload: SpawnBatchCreatedPayload): void {
    this.emittedEvents.push({ event: 'spawn:batch_created', room: REALTIME_ROOMS.GLOBAL, payload });
  }

  public broadcastSpawnsExpired(payload: SpawnExpiredPayload): void {
    this.emittedEvents.push({ event: 'spawn:expired', room: REALTIME_ROOMS.GLOBAL, payload });
  }

  public broadcastManualRotation(payload: RotationManualPayload): void {
    this.emittedEvents.push({ event: 'rotation:manual', room: REALTIME_ROOMS.GLOBAL, payload });
  }

  public broadcastPublicClaim(payload: PublicClaimBroadcastPayload): void {
    this.emittedEvents.push({ event: 'claim:success', room: REALTIME_ROOMS.GLOBAL, payload });
  }

  public emitPersonalClaimSuccess(userId: string, payload: PersonalClaimSuccessPayload): void {
    this.emittedEvents.push({ event: 'claim:success_personal', room: REALTIME_ROOMS.USER(userId), payload });
  }

  public broadcastLeaderboardUpdated(payload: LeaderboardUpdatedPayload): void {
    this.emittedEvents.push({ event: 'leaderboard:updated', room: REALTIME_ROOMS.GLOBAL, payload });
  }

  public broadcastLeaderboardTick(payload: { updatedAt: string }): void {
    this.emittedEvents.push({ event: 'leaderboard:tick', room: REALTIME_ROOMS.GLOBAL, payload });
  }

  public broadcastLeaderboardWeeklyReset(payload: LeaderboardWeeklyResetPayload): void {
    this.emittedEvents.push({ event: 'leaderboard:weekly_reset', room: REALTIME_ROOMS.GLOBAL, payload });
    this.emittedEvents.push({ event: 'cycle:reset', room: REALTIME_ROOMS.GLOBAL, payload });
  }

  public broadcastWeeklyReset(payload: WeeklyResetTriggeredPayload): void {
    this.broadcastLeaderboardWeeklyReset(payload);
  }

  public emitReconnectSyncRequired(userIdOrSocketId: string, payload: ReconnectSyncRequiredPayload): void {
    this.emittedEvents.push({ event: 'reconnect:sync_required', room: REALTIME_ROOMS.USER(userIdOrSocketId), payload });
  }

  public emitNotificationReceived(userId: string, payload: NotificationReceivedPayload): void {
    this.emittedEvents.push({ event: 'notification:received', room: REALTIME_ROOMS.USER(userId), payload });
  }

  public clear(): void {
    this.emittedEvents = [];
  }
}

export const realtimeService = new RealtimeService();
