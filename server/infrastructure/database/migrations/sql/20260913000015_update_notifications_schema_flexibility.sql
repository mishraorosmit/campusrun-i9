-- ============================================================================
-- Migration: 20260913000010_update_notifications_schema_flexibility.sql
-- Description: Drop restrictive check constraints on notification types and allow string entity_id
-- ============================================================================

DO $$
BEGIN
  -- 1. Drop old restrictive check constraints if present
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'notifications' AND constraint_name = 'chk_notifications_type'
  ) THEN
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'notifications' AND constraint_name = 'chk_notifications_entity_type'
  ) THEN
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_entity_type;
  END IF;

  -- 2. Ensure entity_id can store both UUID and custom string IDs
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications' AND column_name = 'entity_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE notifications ALTER COLUMN entity_id TYPE VARCHAR(255) USING entity_id::VARCHAR(255);
  END IF;
END $$;
