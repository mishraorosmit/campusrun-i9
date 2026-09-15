import {
  SpawnBatchCreatedPayload,
  SpawnExpiredPayload,
  PublicClaimBroadcastPayload,
  PersonalClaimSuccessPayload,
  RotationManualPayload,
  LeaderboardUpdatedPayload,
  NotificationReceivedPayload,
  WeeklyResetTriggeredPayload,
  LeaderboardWeeklyResetPayload,
  ReconnectSyncRequiredPayload,
} from '../infrastructure/realtime/events';

export interface IRealtimeService {
  broadcastSpawnBatchCreated(payload: SpawnBatchCreatedPayload): void;
  broadcastSpawnsExpired(payload: SpawnExpiredPayload): void;
  broadcastManualRotation(payload: RotationManualPayload): void;
  broadcastPublicClaim(payload: PublicClaimBroadcastPayload): void;
  emitPersonalClaimSuccess(userId: string, payload: PersonalClaimSuccessPayload): void;
  broadcastLeaderboardUpdated(payload: LeaderboardUpdatedPayload): void;
  broadcastLeaderboardTick?(payload: { updatedAt: string }): void;
  broadcastLeaderboardWeeklyReset(payload: LeaderboardWeeklyResetPayload): void;
  broadcastWeeklyReset?(payload: WeeklyResetTriggeredPayload): void;
  emitReconnectSyncRequired(userIdOrSocketId: string, payload: ReconnectSyncRequiredPayload): void;
  emitNotificationReceived?(userId: string, payload: NotificationReceivedPayload): void;
}
