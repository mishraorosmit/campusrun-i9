import { IGameService, ClaimResult } from './types';
import { INITIAL_SPAWNS, INITIAL_ZONES } from '../data/campusMap';
import {
  CURRENT_PLAYER,
  INITIAL_ROTATION,
  SAMPLE_CLAIMS,
  SAMPLE_WEEKLY_LEADERBOARD,
  SAMPLE_ALLTIME_LEADERBOARD,
  SAMPLE_NOTIFICATIONS,
} from '../data/mockPlayer';
import {
  SpawnPoint,
  CampusZone,
  PlayerProfile,
  ClaimRecord,
  LeaderboardEntry,
  RotationState,
  AppNotification,
  RotationConfig,
  LeaderboardResetSchedule,
  AdminOverviewStats,
  HeatmapPoint,
} from '../types';
import { getTurfDistanceMeters } from '../lib/geo';

export class MockGameService implements IGameService {
  private spawns: SpawnPoint[] = INITIAL_SPAWNS.map(s => ({ ...s, enabled: s.enabled !== false }));
  private zones: CampusZone[] = [...INITIAL_ZONES];
  private player: PlayerProfile = { ...CURRENT_PLAYER };
  private claims: ClaimRecord[] = [...SAMPLE_CLAIMS];
  private weeklyLeaderboard: LeaderboardEntry[] = [...SAMPLE_WEEKLY_LEADERBOARD];
  private allTimeLeaderboard: LeaderboardEntry[] = [...SAMPLE_ALLTIME_LEADERBOARD];
  private notifications: AppNotification[] = [...SAMPLE_NOTIFICATIONS];
  private rotation: RotationState = { ...INITIAL_ROTATION };

  // Documented admin defaults: 30–45 minutes, 15 active points, 60m minimum distance
  private rotationConfig: RotationConfig = {
    intervalMinutes: 45,
    concurrentActivePoints: 15,
    minSpawnDistanceMeters: 60,
    autoRotateEnabled: true,
  };

  // Documented admin default: Sunday at 11:59pm
  private resetSchedule: LeaderboardResetSchedule = {
    resetDay: 'Sunday',
    resetTime: '11:59 PM',
    nextResetTimestamp: new Date(Date.now() + 2 * 86400000 + 14 * 3600000).toISOString(),
    lastResetTimestamp: new Date(Date.now() - 5 * 86400000).toISOString(),
  };

  private spawnListeners: Set<(spawns: SpawnPoint[]) => void> = new Set();
  private leaderboardListeners: Set<(leaderboard: LeaderboardEntry[]) => void> = new Set();

  async getActiveRotation(): Promise<RotationState> {
    return { ...this.rotation };
  }

  async getSpawns(): Promise<SpawnPoint[]> {
    return [...this.spawns];
  }

  async getZones(): Promise<CampusZone[]> {
    return [...this.zones];
  }

  async getPlayerProfile(): Promise<PlayerProfile> {
    return { ...this.player };
  }

  async getClaimsHistory(): Promise<ClaimRecord[]> {
    return [...this.claims];
  }

  async getLeaderboard(period: 'week' | 'all-time' = 'week'): Promise<LeaderboardEntry[]> {
    return period === 'week' ? [...this.weeklyLeaderboard] : [...this.allTimeLeaderboard];
  }

  async getWeeklyLeaderboard(): Promise<LeaderboardEntry[]> {
    return [...this.weeklyLeaderboard];
  }

  async getAllTimeLeaderboard(): Promise<LeaderboardEntry[]> {
    return [...this.allTimeLeaderboard];
  }

  async getNotifications(): Promise<AppNotification[]> {
    return [...this.notifications];
  }

  async markNotificationAsRead(id: string): Promise<void> {
    this.notifications = this.notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n
    );
  }

  subscribeToSpawns(callback: (spawns: SpawnPoint[]) => void): () => void {
    this.spawnListeners.add(callback);
    return () => this.spawnListeners.delete(callback);
  }

  subscribeToLeaderboard(callback: (leaderboard: LeaderboardEntry[]) => void): () => void {
    this.leaderboardListeners.add(callback);
    return () => this.leaderboardListeners.delete(callback);
  }

  private notifyListeners() {
    const currentSpawns = [...this.spawns];
    this.spawnListeners.forEach((cb) => cb(currentSpawns));
    const currentWeekly = [...this.weeklyLeaderboard];
    this.leaderboardListeners.forEach((cb) => cb(currentWeekly));
  }

  async claimSpawn(
    spawnId: string,
    playerLat: number,
    playerLng: number
  ): Promise<ClaimResult> {
    try {
      const resp = await fetch('/api/v1/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spawnId, playerId: this.player.id, lat: playerLat, lng: playerLng })
      });
      
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        return {
          success: false,
          pointsAwarded: 0,
          message: data.error?.message || 'Failed to claim spawn on server',
        };
      }
    } catch (e) {
      console.warn('Backend claim failed', e);
      return {
        success: false,
        pointsAwarded: 0,
        message: 'Network error or backend unavailable',
      };
    }

    const spawnIndex = this.spawns.findIndex((s) => s.id === spawnId);
    if (spawnIndex === -1) {
      return { success: false, pointsAwarded: 0, message: 'Spawn point not found.' };
    }

    const target = this.spawns[spawnIndex];
    if (target.status === 'claimed') {
      return { success: false, pointsAwarded: 0, message: 'This spawn has already been claimed in this rotation.' };
    }

    // Authoritative Turf.js proximity check
    const dist = getTurfDistanceMeters(playerLat, playerLng, target.lat, target.lng);
    if (dist > target.claimRadiusMeters * 3) {
      return {
        success: false,
        pointsAwarded: 0,
        message: `Too far! You are ${dist}m away. Move within ${target.claimRadiusMeters}m to claim.`,
      };
    }

    const oldRank = this.player.rank;

    // 1. Mark spawn as claimed
    const updatedSpawn: SpawnPoint = {
      ...target,
      status: 'claimed',
      claimedBy: this.player.id,
      claimedAt: new Date().toISOString(),
      claimCount: (target.claimCount || 0) + 1,
    };
    this.spawns[spawnIndex] = updatedSpawn;

    // 2. Append to player claim history
    const newClaim: ClaimRecord = {
      id: `claim-${Date.now()}`,
      spawnId: target.id,
      spawnCode: target.code,
      spawnTitle: target.title,
      zoneName: target.zoneName,
      pointsAwarded: target.points,
      claimedAt: new Date().toISOString(),
      tier: target.tier,
      distanceAtClaimMeters: dist,
    };
    this.claims.unshift(newClaim);

    // 3. Update player stats
    this.player.totalPoints += target.points;
    this.player.seasonPoints += target.points;
    this.player.claimsCount += 1;

    // 4. Authoritative Leaderboard Recalculation
    // Find player in weekly leaderboard and update points
    this.weeklyLeaderboard = this.weeklyLeaderboard.map((entry) => {
      if (entry.playerId === this.player.id) {
        return {
          ...entry,
          points: entry.points + target.points,
          claimsCount: entry.claimsCount + 1,
        };
      }
      return entry;
    });

    // Sort leaderboard by points descending
    this.weeklyLeaderboard.sort((a, b) => b.points - a.points);

    // Re-assign ranks
    let newRank = oldRank;
    this.weeklyLeaderboard = this.weeklyLeaderboard.map((entry, index) => {
      const calculatedRank = index + 1;
      if (entry.playerId === this.player.id) {
        newRank = calculatedRank;
      }
      return {
        ...entry,
        rank: calculatedRank,
        rankChange: calculatedRank < entry.rank ? 'up' : calculatedRank > entry.rank ? 'down' : entry.rankChange,
      };
    });

    this.player.rank = newRank;

    // Update all-time board as well
    this.allTimeLeaderboard = this.allTimeLeaderboard.map((entry) => {
      if (entry.playerId === this.player.id) {
        return {
          ...entry,
          points: entry.points + target.points,
          claimsCount: entry.claimsCount + 1,
        };
      }
      return entry;
    });
    this.allTimeLeaderboard.sort((a, b) => b.points - a.points);
    this.allTimeLeaderboard = this.allTimeLeaderboard.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

    // 5. Generate notifications for feed (Screen 08)
    const claimNotif: AppNotification = {
      id: `notif-claim-${Date.now()}`,
      type: 'claim_confirmed',
      title: 'Claim Confirmed',
      body: `Successfully claimed +${target.points} PTS at ${target.title}.`,
      timestamp: new Date().toISOString(),
      read: false,
      meta: {
        pointsAwarded: target.points,
        spawnId: target.id,
      },
    };
    this.notifications.unshift(claimNotif);

    if (newRank < oldRank) {
      const rankNotif: AppNotification = {
        id: `notif-rank-${Date.now()}`,
        type: 'rank_change',
        title: 'Rank Climbed!',
        body: `You climbed to #${newRank} on the Weekly Board (+${target.points} PTS)!`,
        timestamp: new Date().toISOString(),
        read: false,
        meta: {
          newRank,
          pointsAwarded: target.points,
        },
      };
      this.notifications.unshift(rankNotif);
    }

    // Broadcast realtime event
    this.notifyListeners();

    return {
      success: true,
      pointsAwarded: target.points,
      message: `Claimed +${target.points} pts at ${target.title}!`,
      oldRank,
      newRank,
      updatedWeeklyPoints: this.player.seasonPoints,
      updatedTotalPoints: this.player.totalPoints,
      spawn: updatedSpawn,
    };
  }

  // ====================================================
  // A1 — ADMIN OVERVIEW METRICS
  // ====================================================
  async getAdminOverviewStats(): Promise<AdminOverviewStats> {
    const liveSpawns = this.spawns.filter((s) => s.status === 'active' && s.enabled !== false).length;
    const topEntry = this.weeklyLeaderboard[0] || { points: 0, username: 'None' };
    const pointsClaimedToday = this.claims.reduce((acc, c) => acc + c.pointsAwarded, 0) + 12850;

    // Hourly participation chart data (Today's claims)
    const participationOverTime = [
      { hour: '08:00', claims: 14, activeUsers: 22 },
      { hour: '10:00', claims: 38, activeUsers: 54 },
      { hour: '12:00', claims: 86, activeUsers: 112 },
      { hour: '14:00', claims: 72, activeUsers: 95 },
      { hour: '16:00', claims: 94, activeUsers: 130 },
      { hour: '18:00', claims: 65, activeUsers: 88 },
      { hour: '20:00', claims: 42, activeUsers: 60 },
      { hour: '22:00', claims: 19, activeUsers: 28 },
    ];

    // Most claimed spots sorted by claim count
    const spotsWithCount = this.spawns.map((s) => {
      const claimsForSpot = this.claims.filter((c) => c.spawnId === s.id).length;
      return {
        id: s.id,
        code: s.code,
        title: s.title,
        zoneName: s.zoneName,
        claimsCount: (s.claimCount || 0) + claimsForSpot + Math.floor((s.svgX % 15) + 3),
        points: s.points,
        tier: s.tier,
      };
    });

    spotsWithCount.sort((a, b) => b.claimsCount - a.claimsCount);

    return {
      activePlayersCount: 142,
      pointsClaimedToday,
      spawnsLiveCount: liveSpawns,
      totalSpawnsPool: this.spawns.length,
      topScoreThisWeek: topEntry.points || 3850,
      topPlayerUsername: topEntry.username || 'Maya Lin',
      participationOverTime,
      mostClaimedSpots: spotsWithCount.slice(0, 5),
    };
  }

  // ====================================================
  // A2 — SPAWN POINT MANAGEMENT
  // ====================================================
  async saveSpawnPoint(spawn: SpawnPoint): Promise<SpawnPoint> {
    const idx = this.spawns.findIndex((s) => s.id === spawn.id);
    if (idx !== -1) {
      this.spawns[idx] = { ...spawn };
    } else {
      this.spawns.push({ ...spawn });
    }
    this.notifyListeners();
    return spawn;
  }

  async createSpawnPoint(spawnData: Omit<SpawnPoint, 'id'>): Promise<SpawnPoint> {
    const newId = `spawn-${Date.now()}`;
    const newSpawn: SpawnPoint = {
      ...spawnData,
      id: newId,
      code: spawnData.code || `I9-CP-${String(this.spawns.length + 1).padStart(2, '0')}`,
      status: spawnData.status || 'active',
      enabled: spawnData.enabled !== false,
      claimCount: 0,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    this.spawns.push(newSpawn);
    this.notifyListeners();
    return newSpawn;
  }

  async deleteSpawnPoint(spawnId: string): Promise<boolean> {
    this.spawns = this.spawns.filter((s) => s.id !== spawnId);
    this.notifyListeners();
    return true;
  }

  async toggleSpawnStatus(spawnId: string, enabled: boolean): Promise<SpawnPoint> {
    const idx = this.spawns.findIndex((s) => s.id === spawnId);
    if (idx === -1) {
      throw new Error('Spawn not found');
    }
    this.spawns[idx] = {
      ...this.spawns[idx],
      enabled,
      status: enabled ? 'active' : 'expired',
    };
    this.notifyListeners();
    return this.spawns[idx];
  }

  // ====================================================
  // A3 — ROTATION SETTINGS & FORCE ROTATE
  // ====================================================
  async getRotationConfig(): Promise<RotationConfig> {
    return { ...this.rotationConfig };
  }

  async updateRotationConfig(config: Partial<RotationConfig>): Promise<RotationConfig> {
    this.rotationConfig = {
      ...this.rotationConfig,
      ...config,
    };
    return { ...this.rotationConfig };
  }

  async forceRotateNow(): Promise<RotationState> {
    const now = new Date();
    const endsAt = new Date(now.getTime() + this.rotationConfig.intervalMinutes * 60000);
    const rotationNum = this.rotation.rotationNumber + 1;

    // Filter enabled spawns pool
    const eligibleSpawns = this.spawns.filter((s) => s.enabled !== false);
    const targetActiveCount = Math.min(this.rotationConfig.concurrentActivePoints, eligibleSpawns.length);

    // Shuffle and pick target active count ensuring distribution
    const shuffled = [...eligibleSpawns].sort(() => 0.5 - Math.random());
    const selectedIds = new Set(shuffled.slice(0, targetActiveCount).map((s) => s.id));

    this.spawns = this.spawns.map((s) => {
      if (s.enabled === false) {
        return { ...s, status: 'expired' };
      }
      const isActive = selectedIds.has(s.id);
      return {
        ...s,
        status: isActive ? 'active' : 'expired',
        spawnedAt: isActive ? now.toISOString() : undefined,
        expiresAt: endsAt.toISOString(),
        claimedBy: undefined,
        claimedAt: undefined,
      };
    });

    this.rotation = {
      rotationId: `rot-${rotationNum}`,
      rotationNumber: rotationNum,
      startedAt: now.toISOString(),
      endsAt: endsAt.toISOString(),
      totalActiveSpawns: targetActiveCount,
      totalSpawnPointsPool: this.spawns.length,
      status: 'active',
      nextRotationInSeconds: this.rotationConfig.intervalMinutes * 60,
    };

    // System broadcast notification
    const rotNotif: AppNotification = {
      id: `notif-rot-${Date.now()}`,
      type: 'nearby_spawn',
      title: `Rotation #${rotationNum} Live`,
      body: `${targetActiveCount} campus spawn points rotated. New points active now!`,
      timestamp: now.toISOString(),
      read: false,
    };
    this.notifications.unshift(rotNotif);

    this.notifyListeners();
    return { ...this.rotation };
  }

  // ====================================================
  // A4 — LEADERBOARD RESET
  // ====================================================
  async getResetSchedule(): Promise<LeaderboardResetSchedule> {
    return { ...this.resetSchedule };
  }

  async updateResetSchedule(schedule: Partial<LeaderboardResetSchedule>): Promise<LeaderboardResetSchedule> {
    this.resetSchedule = {
      ...this.resetSchedule,
      ...schedule,
    };
    return { ...this.resetSchedule };
  }

  /**
   * CRITICAL BUSINESS RULE:
   * Weekly score resets to 0 for all players.
   * All-time score remains untouched! Never combined into a destructive total.
   */
  async resetWeeklyLeaderboard(): Promise<{ success: boolean; playersResetCount: number; message: string }> {
    const playersCount = this.weeklyLeaderboard.length;

    // Reset current player's seasonPoints to 0 (preserving totalPoints!)
    this.player.seasonPoints = 0;
    this.player.rank = 1;

    // Reset all weekly leaderboard entries to 0 points and 0 claims for new week
    this.weeklyLeaderboard = this.weeklyLeaderboard.map((entry) => ({
      ...entry,
      points: 0,
      claimsCount: 0,
      rank: 1,
      rankChange: 'same',
    }));

    // Update reset schedule last/next timestamps
    const now = new Date();
    this.resetSchedule.lastResetTimestamp = now.toISOString();
    // Next Sunday 11:59 PM
    this.resetSchedule.nextResetTimestamp = new Date(now.getTime() + 7 * 86400000).toISOString();

    // Audit notification
    const resetNotif: AppNotification = {
      id: `notif-reset-${Date.now()}`,
      type: 'reset_countdown',
      title: 'Weekly Standings Reset',
      body: 'Weekly leaderboard has been reset. All-time career totals remain archived.',
      timestamp: now.toISOString(),
      read: false,
    };
    this.notifications.unshift(resetNotif);

    this.notifyListeners();

    return {
      success: true,
      playersResetCount: playersCount,
      message: `Weekly leaderboard reset for ${playersCount} campus players. All-time career scores preserved.`,
    };
  }

  // ====================================================
  // A5 — ANALYTICS HEATMAP DATA
  // ====================================================
  async getHeatmapData(): Promise<HeatmapPoint[]> {
    return this.spawns.map((s, idx) => {
      // Calculate realistic claim intensity based on claims and landmark popularity
      const claimsForSpot = this.claims.filter((c) => c.spawnId === s.id).length;
      const baseCount = (s.claimCount || 0) + claimsForSpot + (idx % 4 === 0 ? 18 : idx % 3 === 0 ? 12 : 5);
      const intensity = Math.min(1.0, Math.max(0.2, baseCount / 25));

      return {
        id: s.id,
        title: s.title,
        zoneName: s.zoneName,
        lat: s.lat,
        lng: s.lng,
        svgX: s.svgX,
        svgY: s.svgY,
        claimsCount: baseCount,
        intensity,
      };
    });
  }
}

export const gameService = new MockGameService();
