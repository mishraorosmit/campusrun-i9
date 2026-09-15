import { Coordinates, SpawnTier } from '../../domain/types';
import { AuthenticatedUser } from '../../middlewares/auth';

/**
 * Realtime Room Architecture Constants
 */
export const REALTIME_ROOMS = {
  GLOBAL: 'campus_global',
  ADMIN: 'admin',
  USER: (userId: string) => `user:${userId}`,
  ZONE: (zoneId: string) => `zone:${zoneId}`,
} as const;

// ============================================================================
// Granular Delta Payloads (Strictly NO full-state dumps)
// ============================================================================

/**
 * Minimal payload for newly spawned batch items.
 */
export interface SpawnDeltaItem {
  id: string;
  code: string;
  title: string;
  points: number;
  tier: SpawnTier | string;
  claimRadiusMeters: number;
  coordinates: Coordinates;
  svgCoordinates?: { x: number; y: number };
  zoneName?: string;
  zoneId?: string;
  expiresAt: string;
}

export interface SpawnBatchCreatedPayload {
  rotationNumber?: number;
  spawns: SpawnDeltaItem[];
  expiresAt?: string;
  timestamp: string;
}

/**
 * Minimal payload when spawn points expire or are removed.
 */
export interface SpawnExpiredPayload {
  spawnIds: string[];
  spawnId?: string;
  spawnCode?: string;
  reason?: 'WINDOW_EXPIRED' | 'ROTATED' | 'DISABLED' | string;
  timestamp: string;
}

/**
 * Anonymous public payload for global claim announcements (strictly NO PII).
 */
export interface PublicClaimBroadcastPayload {
  spawnId: string;
  spawnCode?: string;
  pointsAwarded: number;
  zoneName?: string;
  timestamp: string;
}

/**
 * Full claim receipt payload sent only to the specific user's private room.
 */
export interface PersonalClaimSuccessPayload {
  claimId: string;
  spawnId: string;
  spawnCode: string;
  playerId: string;
  pointsAwarded: number;
  newTotalPoints?: number;
  newSeasonPoints?: number;
  claimedAt: string;
}

export type ClaimSuccessPayload = PublicClaimBroadcastPayload;

/**
 * Minimal payload for leaderboard delta updates (e.g. top rank change or user rank movement).
 */
export interface LeaderboardRankDelta {
  rank: number;
  profile_id: string;
  username: string;
  points: number;
}

export interface LeaderboardUpdatedPayload {
  type: 'weekly' | 'all-time';
  topChanges?: LeaderboardRankDelta[];
  playerRankDelta?: {
    playerId: string;
    oldRank?: number;
    newRank: number;
    points: number;
  };
  updatedAt: string;
}

/**
 * Minimal payload when a manual rotation is triggered.
 */
export interface RotationManualPayload {
  adminId?: string;
  triggeredBy?: string;
  rotationNumber?: number;
  startedAt?: string;
  expiresAt?: string;
  activeSpawnsCount?: number;
  timestamp: string;
}

export interface LeaderboardWeeklyResetPayload {
  cycleId: string;
  nextCycleId?: string;
  resetKey: string;
  executedAt: string;
  nextResetAt: string;
}

/**
 * Minimal payload for targeted player notifications.
 */
export interface NotificationReceivedPayload {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
}

/**
 * Minimal payload when weekly reset event completes.
 */
export interface WeeklyResetTriggeredPayload extends LeaderboardWeeklyResetPayload {}

/**
 * Lightweight sync signal for reconnecting clients (no heavy full-state dumps).
 */
export interface ReconnectSyncRequiredPayload {
  last_updated_timestamp: string;
  cycle_id?: string;
  serverTime: string;
}

// ============================================================================
// Socket.IO Event Contracts
// ============================================================================

export interface ServerToClientEvents {
  'spawn:batch_created': (payload: SpawnBatchCreatedPayload) => void;
  'spawn:expired': (payload: SpawnExpiredPayload) => void;
  'claim:success': (payload: PublicClaimBroadcastPayload) => void;
  'claim:success_personal': (payload: PersonalClaimSuccessPayload) => void;
  'leaderboard:updated': (payload: LeaderboardUpdatedPayload) => void;
  'leaderboard:tick': (payload: { updatedAt: string }) => void;
  'leaderboard:weekly_reset': (payload: LeaderboardWeeklyResetPayload) => void;
  'reconnect:sync_required': (payload: ReconnectSyncRequiredPayload) => void;
  'rotation:manual': (payload: RotationManualPayload) => void;
  'notification:received': (payload: NotificationReceivedPayload) => void;
  'cycle:reset': (payload: WeeklyResetTriggeredPayload) => void;
  'error': (payload: { code: string; message: string }) => void;
}

export interface ClientToServerEvents {
  'room:join_zone': (zoneId: string, ack?: (response: { success: boolean; room: string }) => void) => void;
  'room:leave_zone': (zoneId: string, ack?: (response: { success: boolean; room: string }) => void) => void;
  'reconnect:sync': (ack?: (payload: ReconnectSyncRequiredPayload) => void) => void;
  'ping': (ack?: (pong: string) => void) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  user: AuthenticatedUser;
  userId: string;
  role: string;
  username: string;
  email: string;
}
