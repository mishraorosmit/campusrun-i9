-- ============================================================================
-- Migration: 20260913000006_add_leaderboard_ordering_indexes.sql
-- Description: Prepare database for weekly and all-time leaderboards with deterministic ordering by profile_id
-- ============================================================================

-- 1. Ensure numeric all-time (total_points) and weekly (season_points) columns exist with default 0
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_points INT NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS season_points INT NOT NULL DEFAULT 0;

-- 2. Ensure profile_id column exists on profiles table for deterministic tie-breaking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'profile_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN profile_id UUID;
    UPDATE profiles SET profile_id = user_id WHERE profile_id IS NULL;
  END IF;
END $$;

-- 3. Trigger to keep profile_id synchronized with user_id on insertion
CREATE OR REPLACE FUNCTION sync_profile_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.profile_id IS NULL THEN
    NEW.profile_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_sync_profile_id ON profiles;
CREATE TRIGGER trg_profiles_sync_profile_id
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_id();

-- 4. Create composite B-Tree indexes for weekly and all-time leaderboard ordering with profile_id tie-breaker
CREATE INDEX IF NOT EXISTS idx_profiles_season_points_profile_id ON profiles (season_points DESC, profile_id ASC);
CREATE INDEX IF NOT EXISTS idx_profiles_total_points_profile_id ON profiles (total_points DESC, profile_id ASC);
