-- ============================================================================
-- Migration: 20260913000009_add_notifications_user_read_created_index.sql
-- Description: Composite index on (user_id, read, created_at DESC) for notification queries & unread counts
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created 
  ON notifications (user_id, read, created_at DESC);
