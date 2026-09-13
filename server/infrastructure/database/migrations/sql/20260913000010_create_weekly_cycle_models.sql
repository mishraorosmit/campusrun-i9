-- ============================================================================
-- Migration: 20260913000007_create_weekly_cycle_models.sql
-- Description: Implement weekly competition cycles, reset configuration settings, and reset event recording
-- ============================================================================

-- 1. WEEKLY_CYCLES TABLE
CREATE TABLE IF NOT EXISTS weekly_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Ensure all required columns exist idempotently
ALTER TABLE weekly_cycles ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE weekly_cycles ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days';
ALTER TABLE weekly_cycles ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE weekly_cycles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE weekly_cycles ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Ensure status check constraint allows 'active' and 'completed'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_weekly_cycles_status'
  ) THEN
    ALTER TABLE weekly_cycles ADD CONSTRAINT chk_weekly_cycles_status 
      CHECK (status IN ('active', 'completed', 'upcoming', 'archived'));
  END IF;
END $$;

-- Ensure only one active weekly cycle can exist at a time (Partial Unique Index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_cycles_single_active 
  ON weekly_cycles (status) 
  WHERE status = 'active';

-- 2. WEEKLY_CYCLE_SETTINGS TABLE (Single-row configuration)
CREATE TABLE IF NOT EXISTS weekly_cycle_settings (
  id INT PRIMARY KEY DEFAULT 1,
  reset_weekday INT NOT NULL DEFAULT 0,
  reset_time_utc TIME NOT NULL DEFAULT '23:59:00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_weekly_cycle_settings_single_row CHECK (id = 1),
  CONSTRAINT chk_weekly_cycle_settings_weekday CHECK (reset_weekday >= 0 AND reset_weekday <= 6)
);

-- Auto-update updated_at on modification if update_timestamp_column helper exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_timestamp_column') THEN
    DROP TRIGGER IF EXISTS trg_weekly_cycle_settings_updated_at ON weekly_cycle_settings;
    CREATE TRIGGER trg_weekly_cycle_settings_updated_at
      BEFORE UPDATE ON weekly_cycle_settings
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamp_column();
  END IF;
END $$;

-- Seed default settings if missing: Sunday (0), 23:59:00 UTC
INSERT INTO weekly_cycle_settings (id, reset_weekday, reset_time_utc, updated_at)
VALUES (1, 0, '23:59:00', NOW())
ON CONFLICT (id) DO NOTHING;

-- 3. WEEKLY_RESET_EVENTS TABLE (Idempotent audit ledger of reset executions)
CREATE TABLE IF NOT EXISTS weekly_reset_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL,
  reset_key VARCHAR(255) NOT NULL,
  reset_type VARCHAR(20) NOT NULL,
  triggered_by_profile_id UUID,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_weekly_reset_events_key UNIQUE (reset_key),
  CONSTRAINT fk_weekly_reset_events_cycle FOREIGN KEY (cycle_id) REFERENCES weekly_cycles(id) ON DELETE CASCADE,
  CONSTRAINT fk_weekly_reset_events_triggered_by FOREIGN KEY (triggered_by_profile_id) REFERENCES profiles(user_id) ON DELETE SET NULL,
  CONSTRAINT chk_weekly_reset_events_type CHECK (reset_type IN ('scheduled', 'manual'))
);

-- Index for retrieving reset events by cycle
CREATE INDEX IF NOT EXISTS idx_weekly_reset_events_cycle 
  ON weekly_reset_events (cycle_id, executed_at DESC);

-- Chronological index for audit inspection
CREATE INDEX IF NOT EXISTS idx_weekly_reset_events_executed 
  ON weekly_reset_events (executed_at DESC);
