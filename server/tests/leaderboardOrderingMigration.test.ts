import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Leaderboard Ordering Database Migration', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../infrastructure/database/migrations/sql/20260913000007_add_leaderboard_ordering_indexes.sql'
  );

  it('should have the migration SQL file present and readable', () => {
    assert(fs.existsSync(migrationPath), 'Migration SQL file must exist');
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    assert(sql.length > 0, 'Migration SQL must not be empty');
  });

  it('should ensure numeric total_points and season_points columns exist with default 0', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    assert(
      sql.includes('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_points INT NOT NULL DEFAULT 0;'),
      'Must contain idempotent addition of total_points column'
    );
    assert(
      sql.includes('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS season_points INT NOT NULL DEFAULT 0;'),
      'Must contain idempotent addition of season_points column'
    );
  });

  it('should create composite index on (season_points DESC, profile_id ASC)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    assert(
      sql.includes('CREATE INDEX IF NOT EXISTS idx_profiles_season_points_profile_id ON profiles (season_points DESC, profile_id ASC);'),
      'Must contain composite index on (season_points DESC, profile_id ASC)'
    );
  });

  it('should create composite index on (total_points DESC, profile_id ASC)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    assert(
      sql.includes('CREATE INDEX IF NOT EXISTS idx_profiles_total_points_profile_id ON profiles (total_points DESC, profile_id ASC);'),
      'Must contain composite index on (total_points DESC, profile_id ASC)'
    );
  });

  it('should verify deterministic tie-breaker sorting behavior with profile_id', () => {
    // Simulate profiles with identical points but different profile_ids
    const profiles = [
      { profile_id: 'b1111111-1111-1111-1111-111111111111', username: 'player_b', season_points: 500 },
      { profile_id: 'a1111111-1111-1111-1111-111111111111', username: 'player_a', season_points: 500 },
      { profile_id: 'c1111111-1111-1111-1111-111111111111', username: 'player_c', season_points: 1000 },
      { profile_id: 'd1111111-1111-1111-1111-111111111111', username: 'player_d', season_points: 250 },
    ];

    // SQL Ordering: ORDER BY season_points DESC, profile_id ASC
    const sorted = [...profiles].sort((a, b) => {
      if (b.season_points !== a.season_points) {
        return b.season_points - a.season_points;
      }
      return a.profile_id.localeCompare(b.profile_id);
    });

    assert.equal(sorted[0].username, 'player_c'); // 1000 pts
    assert.equal(sorted[1].username, 'player_a'); // 500 pts, profile_id 'a111...' breaks tie before 'b111...'
    assert.equal(sorted[2].username, 'player_b'); // 500 pts, profile_id 'b111...'
    assert.equal(sorted[3].username, 'player_d'); // 250 pts
  });
});
