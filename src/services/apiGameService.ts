import { IGameService, ClaimResult } from './types';
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
import { MockGameService } from './mockGameService';

const getApiBase = (): string => {
  if (typeof import.meta !== 'undefined') {
    const metaEnv = (import.meta as any).env;
    const custom = metaEnv?.VITE_API_URL || metaEnv?.NEXT_PUBLIC_API_URL;
    if (custom) {
      return custom.endsWith('/api/v1') ? custom : `${custom.replace(/\/$/, '')}/api/v1`;
    }
  }
  return '/api/v1';
};

const API_BASE = getApiBase();

export class ApiGameService implements IGameService {
  private mockFallback: MockGameService = new MockGameService();
  private token: string | null = null;
  private currentRole: 'STUDENT' | 'ADMIN' = 'STUDENT';
  private spawnListeners: Set<(spawns: SpawnPoint[]) => void> = new Set();
  private leaderboardListeners: Set<(leaderboard: LeaderboardEntry[]) => void> = new Set();
  private pollingTimer: any = null;

  constructor() {
    // Check localStorage in browser
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('i9_access_token');
    }
  }

  public setRole(role: 'player' | 'admin'): void {
    this.currentRole = role === 'admin' ? 'ADMIN' : 'STUDENT';
    // Clear cached token so next request acquires appropriate role token
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('i9_access_token');
    }
  }

  private async getAuthToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: this.currentRole,
          email: this.currentRole === 'ADMIN' ? 'admin@campus.edu' : 'student@campus.edu',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        this.token = data.accessToken;
        if (typeof window !== 'undefined' && this.token) {
          localStorage.setItem('i9_access_token', this.token);
        }
        return this.token || '';
      }
    } catch {
      // Backend not running
    }

    return '';
  }

  private async authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const token = await this.getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    return fetch(url, { ...options, headers });
  }

  // -------------------------------------------------------------
  // GAME CORE APIS
  // -------------------------------------------------------------

  async getActiveRotation(): Promise<RotationState> {
    try {
      const res = await this.authFetch(`${API_BASE}/game/rotation`);
      if (res.ok) {
        const json = await res.json();
        const d = json.data;
        if (d) {
          return {
            rotationId: d.id || 'rot-1',
            rotationNumber: d.rotationNumber || 1,
            startedAt: d.startedAt || new Date().toISOString(),
            endsAt: d.expiresAt || new Date(Date.now() + 45 * 60000).toISOString(),
            totalActiveSpawns: d.activeSpawns || 15,
            totalSpawnPointsPool: d.totalSpawns || 36,
            status: 'active',
            nextRotationInSeconds: d.nextRotationInSeconds ?? 2700,
          };
        }
      }
    } catch {
      // fallback
    }
    return this.mockFallback.getActiveRotation();
  }

  async getSpawns(): Promise<SpawnPoint[]> {
    try {
      const res = await this.authFetch(`${API_BASE}/spawns/active`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data) && json.data.length > 0) {
          return json.data.map((item: any) => ({
            id: item.id,
            code: item.code,
            title: item.title,
            description: item.description,
            clue: item.clue,
            zoneId: item.zoneId || 'zone-academic-core',
            zoneName: item.zoneName || 'Academic Quad',
            lat: item.lat ?? item.coordinates?.lat ?? 37.4275,
            lng: item.lng ?? item.coordinates?.lng ?? -122.1695,
            svgX: item.svgX ?? item.svgCoordinates?.x ?? 500,
            svgY: item.svgY ?? item.svgCoordinates?.y ?? 500,
            points: Number(item.points) || 100,
            tier: item.tier || 'tier1',
            status: item.status || 'active',
            claimRadiusMeters: Number(item.claimRadiusMeters) || 25,
            enabled: item.enabled !== false,
            expiresAt: item.expiresAt || new Date(Date.now() + 30 * 60000).toISOString(),
            claimCount: Number(item.claimCount) || 0,
            maxClaims: item.maxClaims,
          }));
        }
      }
    } catch {
      // fallback
    }
    return this.mockFallback.getSpawns();
  }

  async getZones(): Promise<CampusZone[]> {
    try {
      const res = await this.authFetch(`${API_BASE}/zones`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data) && json.data.length > 0) {
          return json.data.map((z: any) => ({
            id: z.id,
            name: z.name,
            code: z.code,
            description: z.description,
            svgPath: z.svgPath,
            centerLat: z.centerLat ?? z.centerCoordinates?.lat,
            centerLng: z.centerLng ?? z.centerCoordinates?.lng,
            centerSvgX: z.centerSvgX ?? z.centerSvgCoordinates?.x,
            centerSvgY: z.centerSvgY ?? z.centerSvgCoordinates?.y,
            activeSpawnsCount: Number(z.activeSpawnsCount) || 0,
            totalPointsAvailable: Number(z.totalPointsAvailable) || 0,
            color: z.color,
          }));
        }
      }
    } catch {
      // fallback
    }
    return this.mockFallback.getZones();
  }

  async getPlayerProfile(playerId?: string): Promise<PlayerProfile> {
    try {
      const endpoint = playerId ? `${API_BASE}/player/${playerId}` : `${API_BASE}/player/me`;
      const res = await this.authFetch(endpoint);
      if (res.ok) {
        const json = await res.json();
        const p = json.data;
        if (p) {
          return {
            id: p.id,
            email: p.email,
            username: p.username,
            avatarUrl: p.avatarUrl,
            totalPoints: Number(p.totalPoints) || 0,
            seasonPoints: Number(p.seasonPoints) || 0,
            rank: Number(p.rank) || 1,
            tier: p.tier || 'tier1',
            claimsCount: Number(p.claimsCount) || 0,
            currentStreakDays: Number(p.currentStreakDays) || 0,
            role: (p.role?.toLowerCase() === 'admin' ? 'admin' : 'player'),
            createdAt: p.createdAt || new Date().toISOString(),
            lastActiveAt: p.lastActiveAt || new Date().toISOString(),
          };
        }
      }
    } catch {
      // fallback
    }
    return this.mockFallback.getPlayerProfile();
  }

  async getClaimsHistory(_playerId?: string): Promise<ClaimRecord[]> {
    try {
      const res = await this.authFetch(`${API_BASE}/claims/history`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          return json.data.map((c: any) => ({
            id: c.id,
            spawnId: c.spawnId,
            spawnCode: c.spawnCode,
            spawnTitle: c.spawnTitle,
            zoneName: c.zoneName || 'Campus Zone',
            pointsAwarded: Number(c.pointsAwarded),
            claimedAt: c.claimedAt,
            tier: c.tier || 'tier1',
            distanceAtClaimMeters: Number(c.distanceMeters) || 0,
          }));
        }
      }
    } catch {
      // fallback
    }
    return this.mockFallback.getClaimsHistory();
  }

  async getLeaderboard(period: 'week' | 'all-time' = 'week'): Promise<LeaderboardEntry[]> {
    return period === 'week' ? this.getWeeklyLeaderboard() : this.getAllTimeLeaderboard();
  }

  async getWeeklyLeaderboard(): Promise<LeaderboardEntry[]> {
    try {
      const res = await this.authFetch(`${API_BASE}/leaderboard/weekly`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data) && json.data.length > 0) {
          return json.data.map((r: any) => ({
            rank: Number(r.rank),
            playerId: r.playerId,
            username: r.username,
            avatarUrl: r.avatarUrl,
            points: Number(r.points),
            claimsCount: Number(r.claimsCount),
            tier: r.tier || 'tier1',
            rankChange: r.rankChange || 'same',
          }));
        }
      }
    } catch {
      // fallback
    }
    return this.mockFallback.getWeeklyLeaderboard();
  }

  async getAllTimeLeaderboard(): Promise<LeaderboardEntry[]> {
    try {
      const res = await this.authFetch(`${API_BASE}/leaderboard/all-time`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data) && json.data.length > 0) {
          return json.data.map((r: any) => ({
            rank: Number(r.rank),
            playerId: r.playerId,
            username: r.username,
            avatarUrl: r.avatarUrl,
            points: Number(r.points),
            claimsCount: Number(r.claimsCount),
            tier: r.tier || 'tier1',
            rankChange: r.rankChange || 'same',
          }));
        }
      }
    } catch {
      // fallback
    }
    return this.mockFallback.getAllTimeLeaderboard();
  }

  async getNotifications(): Promise<AppNotification[]> {
    return this.mockFallback.getNotifications();
  }

  async markNotificationAsRead(id: string): Promise<void> {
    return this.mockFallback.markNotificationAsRead(id);
  }

  async claimSpawn(spawnId: string, playerLat: number, playerLng: number): Promise<ClaimResult> {
    try {
      const res = await this.authFetch(`${API_BASE}/claims`, {
        method: 'POST',
        body: JSON.stringify({
          spawnId,
          latitude: playerLat,
          longitude: playerLng,
        }),
      });

      const json = await res.json();

      if (res.ok && json.success) {
        const claimData = json.data;
        this.notifyListeners();
        return {
          success: true,
          pointsAwarded: claimData.pointsAwarded,
          message: `Claim confirmed! +${claimData.pointsAwarded} PTS at ${claimData.spawnName}.`,
          oldRank: claimData.weeklyRank ? claimData.weeklyRank + 1 : undefined,
          newRank: claimData.weeklyRank,
          updatedWeeklyPoints: claimData.weeklyPoints,
          updatedTotalPoints: claimData.allTimePoints,
        };
      } else {
        const errDetail = json.error?.message || json.message || 'Claim validation failed';
        return {
          success: false,
          pointsAwarded: 0,
          message: errDetail,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        pointsAwarded: 0,
        message: err.message || 'Network error during claim submission',
      };
    }
  }

  // -------------------------------------------------------------
  // ADMIN APIS
  // -------------------------------------------------------------

  async getAdminOverviewStats(): Promise<AdminOverviewStats> {
    try {
      const res = await this.authFetch(`${API_BASE}/admin/overview`);
      if (res.ok) {
        const json = await res.json();
        return json.data;
      }
    } catch {
      // fallback
    }
    return this.mockFallback.getAdminOverviewStats();
  }

  async getRotationConfig(): Promise<RotationConfig> {
    try {
      const res = await this.authFetch(`${API_BASE}/admin/rotation/config`);
      if (res.ok) {
        const json = await res.json();
        return json.data;
      }
    } catch {
      // fallback
    }
    return this.mockFallback.getRotationConfig();
  }

  async updateRotationConfig(config: Partial<RotationConfig>): Promise<RotationConfig> {
    try {
      const res = await this.authFetch(`${API_BASE}/admin/rotation/config`, {
        method: 'PUT',
        body: JSON.stringify(config),
      });
      if (res.ok) {
        return this.getRotationConfig();
      }
    } catch {
      // fallback
    }
    return this.mockFallback.updateRotationConfig(config);
  }

  async forceRotateNow(): Promise<RotationState> {
    try {
      const res = await this.authFetch(`${API_BASE}/admin/rotate`, {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      });
      if (res.ok) {
        this.notifyListeners();
        return this.getActiveRotation();
      }
    } catch {
      // fallback
    }
    return this.mockFallback.forceRotateNow();
  }

  async getResetSchedule(): Promise<LeaderboardResetSchedule> {
    try {
      const res = await this.authFetch(`${API_BASE}/admin/cycles/config`);
      if (res.ok) {
        const json = await res.json();
        return json.data;
      }
    } catch {
      // fallback
    }
    return this.mockFallback.getResetSchedule();
  }

  async updateResetSchedule(schedule: Partial<LeaderboardResetSchedule>): Promise<LeaderboardResetSchedule> {
    try {
      const res = await this.authFetch(`${API_BASE}/admin/cycles/config`, {
        method: 'PUT',
        body: JSON.stringify(schedule),
      });
      if (res.ok) {
        return this.getResetSchedule();
      }
    } catch {
      // fallback
    }
    return this.mockFallback.updateResetSchedule(schedule);
  }

  async resetWeeklyLeaderboard(): Promise<{ success: boolean; playersResetCount: number; message: string }> {
    try {
      const res = await this.authFetch(`${API_BASE}/admin/cycles/reset`, {
        method: 'POST',
      });
      if (res.ok) {
        const json = await res.json();
        this.notifyListeners();
        return json;
      }
    } catch {
      // fallback
    }
    return this.mockFallback.resetWeeklyLeaderboard();
  }

  async saveSpawnPoint(spawn: SpawnPoint): Promise<SpawnPoint> {
    try {
      const res = await this.authFetch(`${API_BASE}/admin/spawns/${spawn.id}`, {
        method: 'PATCH',
        body: JSON.stringify(spawn),
      });
      if (res.ok) {
        this.notifyListeners();
        const json = await res.json();
        return json.data;
      }
    } catch {
      // fallback
    }
    return this.mockFallback.saveSpawnPoint(spawn);
  }

  async createSpawnPoint(spawnData: Omit<SpawnPoint, 'id'>): Promise<SpawnPoint> {
    try {
      const res = await this.authFetch(`${API_BASE}/admin/spawns`, {
        method: 'POST',
        body: JSON.stringify({
          ...spawnData,
          coordinates: { lat: spawnData.lat, lng: spawnData.lng },
          svgCoordinates: { x: spawnData.svgX, y: spawnData.svgY },
        }),
      });
      if (res.ok) {
        this.notifyListeners();
        const json = await res.json();
        return json.data;
      }
    } catch {
      // fallback
    }
    return this.mockFallback.createSpawnPoint(spawnData);
  }

  async deleteSpawnPoint(spawnId: string): Promise<boolean> {
    return this.mockFallback.deleteSpawnPoint(spawnId);
  }

  async toggleSpawnStatus(spawnId: string, enabled: boolean): Promise<SpawnPoint> {
    try {
      const res = await this.authFetch(`${API_BASE}/admin/spawns/${spawnId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        this.notifyListeners();
        const json = await res.json();
        return json.data;
      }
    } catch {
      // fallback
    }
    return this.mockFallback.toggleSpawnStatus(spawnId, enabled);
  }

  async getHeatmapData(): Promise<HeatmapPoint[]> {
    return this.mockFallback.getHeatmapData();
  }

  // -------------------------------------------------------------
  // SUBSCRIPTIONS & REALTIME REFRESH
  // -------------------------------------------------------------

  subscribeToSpawns(callback: (spawns: SpawnPoint[]) => void): () => void {
    this.spawnListeners.add(callback);
    this.ensurePolling();
    return () => this.spawnListeners.delete(callback);
  }

  subscribeToLeaderboard(callback: (leaderboard: LeaderboardEntry[]) => void): () => void {
    this.leaderboardListeners.add(callback);
    this.ensurePolling();
    return () => this.leaderboardListeners.delete(callback);
  }

  private ensurePolling(): void {
    if (this.pollingTimer) return;
    this.pollingTimer = setInterval(async () => {
      await this.notifyListeners();
    }, 15000); // 15-second background refresh
  }

  private async notifyListeners(): Promise<void> {
    if (this.spawnListeners.size > 0) {
      const spawns = await this.getSpawns();
      for (const listener of this.spawnListeners) {
        try {
          listener(spawns);
        } catch {}
      }
    }
    if (this.leaderboardListeners.size > 0) {
      const lb = await this.getWeeklyLeaderboard();
      for (const listener of this.leaderboardListeners) {
        try {
          listener(lb);
        } catch {}
      }
    }
  }
}

export const apiGameService = new ApiGameService();
