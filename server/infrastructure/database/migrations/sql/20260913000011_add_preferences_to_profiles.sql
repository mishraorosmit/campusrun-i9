-- ============================================================================
-- Migration: 20260913000008_add_preferences_to_profiles.sql
-- Description: Add preferences JSONB column to profiles table with default empty object
-- ============================================================================

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
