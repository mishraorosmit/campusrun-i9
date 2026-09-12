-- ============================================================================
-- Migration: 20260913000005_add_unique_claim_constraint.sql
-- Description: Add a unique constraint to prevent a player from claiming the same spawn point more than once across all rotations.
-- ============================================================================

ALTER TABLE claims DROP CONSTRAINT IF EXISTS uq_claims_player_spawn;
ALTER TABLE claims ADD CONSTRAINT uq_claims_player_spawn UNIQUE (player_id, spawn_id);
