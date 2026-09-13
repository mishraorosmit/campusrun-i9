-- ============================================================================
-- Migration: 20260913000007_add_status_to_spawn_batches.sql
-- Description: Add lifecycle status column to spawn_batches with CREATED, ACTIVE, EXPIRED states
--              and unique active index per cycle.
-- ============================================================================

ALTER TABLE spawn_batches
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'CREATED';

-- Update existing records to match lifecycle status
UPDATE spawn_batches
  SET status = CASE
    WHEN is_active = true AND expires_at > NOW() THEN 'ACTIVE'
    WHEN expires_at <= NOW() THEN 'EXPIRED'
    ELSE 'CREATED'
  END;

-- Add check constraint for legal states
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_spawn_batches_status'
  ) THEN
    ALTER TABLE spawn_batches
      ADD CONSTRAINT chk_spawn_batches_status
      CHECK (status IN ('CREATED', 'ACTIVE', 'EXPIRED'));
  END IF;
END $$;

-- Lifecycle status index
CREATE INDEX IF NOT EXISTS idx_spawn_batches_lifecycle_status
  ON spawn_batches (cycle_id, status);

-- Ensure at most ONE active batch exists per cycle simultaneously
CREATE UNIQUE INDEX IF NOT EXISTS idx_spawn_batches_unique_active
  ON spawn_batches (cycle_id)
  WHERE status = 'ACTIVE';
