-- ============================================================================
-- Migration: 20260913000004_create_notifications_subscriptions_settings_audit_analytics.sql
-- Description: Create notifications, push_subscriptions, game_settings, audit_logs, and analytics_events
-- ============================================================================

-- 1. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  entity_type VARCHAR(50),
  entity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_notifications_type CHECK (type IN (
    'spawn_rotation', 'claim_reward', 'streak_reminder', 'leaderboard_rank', 'system_announcement'
  )),
  CONSTRAINT chk_notifications_entity_type CHECK (
    entity_type IS NULL OR entity_type IN ('spawn_point', 'spawn_batch', 'weekly_cycle', 'claim')
  )
);

-- Partial index for fast unread notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
  ON notifications (user_id, created_at DESC) 
  WHERE read = false;

-- 2. PUSH_SUBSCRIPTIONS TABLE (Multi-device subscriptions per user)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_push_subscriptions_endpoint UNIQUE (endpoint)
);

CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp_column();

CREATE INDEX IF NOT EXISTS idx_push_subs_user 
  ON push_subscriptions (user_id);

-- 3. GAME_SETTINGS TABLE (Authoritative singleton / key-value configuration)
CREATE TABLE IF NOT EXISTS game_settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_game_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_game_settings_key_format CHECK (key ~ '^[a-z0-9_.]+$')
);

CREATE TRIGGER trg_game_settings_updated_at
  BEFORE UPDATE ON game_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp_column();

-- Seed initial authoritative game settings
INSERT INTO game_settings (key, value, description)
VALUES 
  ('engine.rotation_interval_minutes', '{"value": 45}'::jsonb, 'Minutes between automated spawn rotation cycles'),
  ('engine.claim_radius_meters', '{"value": 25.0}'::jsonb, 'Maximum radius in meters for geofence verification'),
  ('engine.min_spawn_distance_meters', '{"value": 60.0}'::jsonb, 'Minimum distance in meters between concurrent active spawns'),
  ('engine.concurrent_active_spawns', '{"value": 15}'::jsonb, 'Standard count of active spawns per rotation'),
  ('engine.streak_grace_hours', '{"value": 24}'::jsonb, 'Grace period in hours before streak reset')
ON CONFLICT (key) DO NOTHING;

-- 4. AUDIT_LOGS TABLE (Security / Admin mutations; NO credentials or secrets)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_entity VARCHAR(64) NOT NULL,
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_audit_logs_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_audit_logs_action_format CHECK (action ~ '^[A-Z0-9_]+$')
);

-- Chronological audit inspection
CREATE INDEX IF NOT EXISTS idx_audit_logs_created 
  ON audit_logs (created_at DESC);

-- Admin mutation timeline lookup
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin 
  ON audit_logs (admin_id, created_at DESC);

-- 5. ANALYTICS_EVENTS TABLE (Append-only telemetry; isolated from transactional game state)
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  event_name VARCHAR(64) NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_analytics_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_analytics_event_name_len CHECK (length(event_name) >= 3)
);

-- Time-window aggregation by event name
CREATE INDEX IF NOT EXISTS idx_analytics_name_created 
  ON analytics_events (event_name, created_at DESC);

-- User-specific event activity timeline
CREATE INDEX IF NOT EXISTS idx_analytics_user 
  ON analytics_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
