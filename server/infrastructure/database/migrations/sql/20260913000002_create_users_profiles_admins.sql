-- ============================================================================
-- Migration: 20260913000002_create_users_profiles_admins.sql
-- Description: Create users, profiles, and admins tables with constraints and indexes
-- ============================================================================

-- 1. Helper function to automatically maintain updated_at timestamps
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT chk_users_email_len CHECK (length(email) >= 5),
  CONSTRAINT chk_users_status CHECK (status IN ('active', 'suspended', 'deactivated'))
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp_column();

-- 3. PROFILES TABLE (1:1 with users)
CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY,
  username VARCHAR(30) NOT NULL,
  display_name VARCHAR(50),
  avatar_url VARCHAR(512),
  total_points INT NOT NULL DEFAULT 0,
  season_points INT NOT NULL DEFAULT 0,
  claims_count INT NOT NULL DEFAULT 0,
  current_streak_days INT NOT NULL DEFAULT 0,
  longest_streak_days INT NOT NULL DEFAULT 0,
  last_streak_claim_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_profiles_username UNIQUE (username),
  CONSTRAINT chk_profiles_username_format CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  CONSTRAINT chk_profiles_total_points CHECK (total_points >= 0),
  CONSTRAINT chk_profiles_season_points CHECK (season_points >= 0),
  CONSTRAINT chk_profiles_claims_count CHECK (claims_count >= 0),
  CONSTRAINT chk_profiles_current_streak CHECK (current_streak_days >= 0),
  CONSTRAINT chk_profiles_longest_streak CHECK (longest_streak_days >= 0),
  CONSTRAINT chk_profiles_streak_consistency CHECK (longest_streak_days >= current_streak_days)
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp_column();

-- Leaderboard ranking indexes (composite with updated_at ASC for deterministic rank tie-breaking)
CREATE INDEX IF NOT EXISTS idx_profiles_season_points ON profiles (season_points DESC, updated_at ASC);
CREATE INDEX IF NOT EXISTS idx_profiles_total_points ON profiles (total_points DESC, updated_at ASC);

-- 4. ADMINS TABLE (Independent from player profile data)
CREATE TABLE IF NOT EXISTS admins (
  user_id UUID PRIMARY KEY,
  role VARCHAR(20) NOT NULL DEFAULT 'admin',
  granted_by UUID,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,

  CONSTRAINT fk_admins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_admins_granted_by FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_admins_role CHECK (role IN ('moderator', 'admin', 'superadmin'))
);
