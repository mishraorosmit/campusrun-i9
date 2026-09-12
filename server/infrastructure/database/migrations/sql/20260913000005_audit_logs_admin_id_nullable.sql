-- ============================================================================
-- Migration: 20260913000005_audit_logs_admin_id_nullable.sql
-- Description: Allow audit_logs.admin_id to be nullable for recording unauthenticated security events
-- ============================================================================

ALTER TABLE audit_logs ALTER COLUMN admin_id DROP NOT NULL;
