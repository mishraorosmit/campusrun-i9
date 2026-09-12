-- ============================================================================
-- Migration: 20260913000003_create_cycles_batches_spawns_claims.sql
-- Description: Create weekly_cycles, spawn_batches, spawn_points, and claims tables
-- ============================================================================

-- 1. WEEKLY_CYCLES TABLE
CREATE TABLE IF NOT EXISTS weekly_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_number INT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_weekly_cycles_number UNIQUE (cycle_number),
  CONSTRAINT chk_weekly_cycles_number CHECK (cycle_number > 0),
  CONSTRAINT chk_weekly_cycles_duration CHECK (ends_at > starts_at),
  CONSTRAINT chk_weekly_cycles_status CHECK (status IN ('upcoming', 'active', 'completed', 'archived'))
);

-- Ensure at most ONE active cycle can exist simultaneously
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_cycles_unique_active 
  ON weekly_cycles (status) 
  WHERE status = 'active';

-- 2. SPAWN_BATCHES TABLE
CREATE TABLE IF NOT EXISTS spawn_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number INT NOT NULL,
  cycle_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_spawn_batches_number UNIQUE (batch_number),
  CONSTRAINT fk_spawn_batches_cycle FOREIGN KEY (cycle_id) REFERENCES weekly_cycles(id) ON DELETE RESTRICT,
  CONSTRAINT chk_spawn_batches_number CHECK (batch_number > 0),
  CONSTRAINT chk_spawn_batches_duration CHECK (expires_at > started_at)
);

-- Partial index for fast active batch retrieval
CREATE INDEX IF NOT EXISTS idx_spawn_batches_active 
  ON spawn_batches (cycle_id, is_active) 
  WHERE is_active = true;

-- 3. SPAWN_POINTS TABLE
-- Spatial location stores WGS 84 (lng, lat) as native geometric point with GiST spatial indexing,
-- accompanied by stored generated lat/lng columns and coordinate boundary checks.
CREATE TABLE IF NOT EXISTS spawn_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(32) NOT NULL,
  batch_id UUID,
  title VARCHAR(100) NOT NULL,
  description TEXT,
  clue TEXT,
  tier VARCHAR(20) NOT NULL DEFAULT 'tier1',
  points INT NOT NULL DEFAULT 100,
  claim_radius_meters FLOAT8 NOT NULL DEFAULT 25.0,
  location point NOT NULL,
  lat double precision GENERATED ALWAYS AS (location[1]) STORED,
  lng double precision GENERATED ALWAYS AS (location[0]) STORED,
  svg_x INT NOT NULL DEFAULT 0,
  svg_y INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  enabled BOOLEAN NOT NULL DEFAULT true,
  claim_count INT NOT NULL DEFAULT 0,
  max_claims INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_spawn_points_code UNIQUE (code),
  CONSTRAINT fk_spawn_points_batch FOREIGN KEY (batch_id) REFERENCES spawn_batches(id) ON DELETE SET NULL,
  CONSTRAINT chk_spawn_points_code_len CHECK (length(code) >= 3),
  CONSTRAINT chk_spawn_points_tier CHECK (tier IN ('tier1', 'tier2', 'tier3', 'tier4')),
  CONSTRAINT chk_spawn_points_points CHECK (points > 0),
  CONSTRAINT chk_spawn_points_claim_radius CHECK (claim_radius_meters >= 5.0 AND claim_radius_meters <= 150.0),
  CONSTRAINT chk_spawn_points_lat CHECK (location[1] >= -90.0 AND location[1] <= 90.0),
  CONSTRAINT chk_spawn_points_lng CHECK (location[0] >= -180.0 AND location[0] <= 180.0),
  CONSTRAINT chk_spawn_points_svg_x CHECK (svg_x >= 0),
  CONSTRAINT chk_spawn_points_svg_y CHECK (svg_y >= 0),
  CONSTRAINT chk_spawn_points_status CHECK (status IN ('active', 'claimed', 'cooldown', 'expired')),
  CONSTRAINT chk_spawn_points_claim_count CHECK (claim_count >= 0),
  CONSTRAINT chk_spawn_points_max_claims CHECK (max_claims IS NULL OR max_claims > 0)
);

CREATE TRIGGER trg_spawn_points_updated_at
  BEFORE UPDATE ON spawn_points
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp_column();

-- Spatial GiST index on spawn locations (native PostGIS/Postgres GiST indexing)
CREATE INDEX IF NOT EXISTS idx_spawns_location_gist 
  ON spawn_points USING GIST (location);

-- Partial index for active, enabled spawns in a batch
CREATE INDEX IF NOT EXISTS idx_spawns_active_status 
  ON spawn_points (batch_id, status) 
  WHERE enabled = true;

-- 4. CLAIMS TABLE (Immutable claims ledger)
CREATE TABLE IF NOT EXISTS claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL,
  spawn_id UUID NOT NULL,
  batch_id UUID NOT NULL,
  points_awarded INT NOT NULL,
  streak_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  distance_meters FLOAT8 NOT NULL,
  player_location point NOT NULL,
  player_lat double precision GENERATED ALWAYS AS (player_location[1]) STORED,
  player_lng double precision GENERATED ALWAYS AS (player_location[0]) STORED,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_claims_player FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_claims_spawn FOREIGN KEY (spawn_id) REFERENCES spawn_points(id) ON DELETE RESTRICT,
  CONSTRAINT fk_claims_batch FOREIGN KEY (batch_id) REFERENCES spawn_batches(id) ON DELETE RESTRICT,
  CONSTRAINT uq_claims_player_spawn_batch UNIQUE (player_id, spawn_id, batch_id),
  CONSTRAINT chk_claims_points CHECK (points_awarded > 0),
  CONSTRAINT chk_claims_multiplier CHECK (streak_multiplier >= 1.00 AND streak_multiplier <= 5.00),
  CONSTRAINT chk_claims_distance CHECK (distance_meters >= 0.0),
  CONSTRAINT chk_claims_player_lat CHECK (player_location[1] >= -90.0 AND player_location[1] <= 90.0),
  CONSTRAINT chk_claims_player_lng CHECK (player_location[0] >= -180.0 AND player_location[0] <= 180.0)
);

-- Chronological index for player claim history
CREATE INDEX IF NOT EXISTS idx_claims_player_history 
  ON claims (player_id, claimed_at DESC);

-- Chronological index for spawn claim history (admin / analytics)
CREATE INDEX IF NOT EXISTS idx_claims_spawn_history 
  ON claims (spawn_id, claimed_at DESC);
