-- ============================================================================
-- Migration: 20260913000001_enable_postgis.sql
-- Description: Establish database foundation extensions and PostGIS availability
-- ============================================================================

-- 1. UUID generation extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. PostGIS spatial extension (enabled if installed in PostgreSQL cluster)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    CREATE EXTENSION IF NOT EXISTS postgis;
    RAISE NOTICE 'PostGIS extension successfully enabled.';
  ELSE
    RAISE NOTICE 'PostGIS extension is not installed in the PostgreSQL server extensions directory.';
  END IF;
END $$;

-- 3. Verify UTC timezone is active for this session
SET timezone = 'UTC';
