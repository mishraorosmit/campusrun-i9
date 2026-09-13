-- Migration: 20260913000008_add_spawn_ids_to_spawn_batches.sql
-- Description: Add spawn_ids UUID[] column to spawn_batches for persistent batch membership

ALTER TABLE spawn_batches
  ADD COLUMN IF NOT EXISTS spawn_ids UUID[] NOT NULL DEFAULT '{}';

-- Backfill from existing spawn_points where batch_id is set
UPDATE spawn_batches b
SET spawn_ids = sub.ids
FROM (
  SELECT batch_id, ARRAY_AGG(id) as ids
  FROM spawn_points
  WHERE batch_id IS NOT NULL
  GROUP BY batch_id
) sub
WHERE b.id = sub.batch_id AND b.spawn_ids = '{}';
