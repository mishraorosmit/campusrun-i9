import { DatabasePool, dbPool } from '../infrastructure/database/pool';
import { config } from '../config';

export interface GameSettingsSnapshot {
  rotationIntervalMinutes: number;
  concurrentActiveSpawns: number;
  minSpawnDistanceMeters: number;
  claimRadiusMeters: number;
}

export class GameSettingsService {
  constructor(private readonly pool: DatabasePool = dbPool) {}

  public async getSettings(): Promise<GameSettingsSnapshot> {
    const defaults: GameSettingsSnapshot = {
      rotationIntervalMinutes: config.ROTATION_INTERVAL_MINUTES || 45,
      concurrentActiveSpawns: config.CONCURRENT_ACTIVE_SPAWNS || 15,
      minSpawnDistanceMeters: 60.0,
      claimRadiusMeters: 25.0,
    };

    try {
      const res = await this.pool.query<{ key: string; value: any }>(
        `SELECT key, value FROM game_settings;`
      );

      for (const row of res.rows) {
        const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        const rawValue = val?.value ?? val;

        switch (row.key) {
          case 'engine.rotation_interval_minutes':
            if (typeof rawValue === 'number') defaults.rotationIntervalMinutes = rawValue;
            break;
          case 'engine.concurrent_active_spawns':
            if (typeof rawValue === 'number') defaults.concurrentActiveSpawns = rawValue;
            break;
          case 'engine.min_spawn_distance_meters':
            if (typeof rawValue === 'number') defaults.minSpawnDistanceMeters = rawValue;
            break;
          case 'engine.claim_radius_meters':
            if (typeof rawValue === 'number') defaults.claimRadiusMeters = rawValue;
            break;
        }
      }
    } catch {
      // Fallback to defaults if table unavailable
    }

    return defaults;
  }
}
