-- ============================================================================
-- Migration: 20260913000006_create_campus_boundaries_and_geo_indexes.sql
-- Description: Authoritative campus boundaries, PostGIS geometry/geography types,
--              GiST spatial indexing, and canonical calibration metadata.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'geography') THEN
    -- PostGIS Native Geography Mode
    CREATE TABLE IF NOT EXISTS campus_boundaries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      boundary GEOGRAPHY(Polygon, 4326) NOT NULL,
      min_lat DOUBLE PRECISION NOT NULL,
      max_lat DOUBLE PRECISION NOT NULL,
      min_lng DOUBLE PRECISION NOT NULL,
      max_lng DOUBLE PRECISION NOT NULL,
      svg_width INT NOT NULL DEFAULT 1572,
      svg_height INT NOT NULL DEFAULT 2927,
      svg_viewbox VARCHAR(50) NOT NULL DEFAULT '0 0 1572 2927',
      is_active BOOLEAN NOT NULL DEFAULT true,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_campus_boundaries_boundary_gist
      ON campus_boundaries USING GIST (boundary);

    -- Seed canonical campus boundary with PostGIS GEOGRAPHY Polygon
    INSERT INTO campus_boundaries (
      code,
      name,
      description,
      boundary,
      min_lat,
      max_lat,
      min_lng,
      max_lng,
      svg_width,
      svg_height,
      svg_viewbox,
      metadata
    ) VALUES (
      'CANONICAL_CAMPUS',
      'Authoritative Institutional Campus',
      'Authoritative boundary matching the canonical 1572 x 2927 campus SVG vector illustration.',
      ST_GeogFromText('POLYGON((-122.1765 37.4330, -122.1615 37.4330, -122.1615 37.4215, -122.1765 37.4215, -122.1765 37.4330))'),
      37.4215,
      37.4330,
      -122.1765,
      -122.1615,
      1572,
      2927,
      '0 0 1572 2927',
      '{
        "srid": 4326,
        "control_points_count": 8,
        "coordinate_convention": "lat_first_in_api_lng_first_in_postgis",
        "units": "meters"
      }'::jsonb
    ) ON CONFLICT (code) DO UPDATE SET
      boundary = EXCLUDED.boundary,
      min_lat = EXCLUDED.min_lat,
      max_lat = EXCLUDED.max_lat,
      min_lng = EXCLUDED.min_lng,
      max_lng = EXCLUDED.max_lng,
      svg_width = EXCLUDED.svg_width,
      svg_height = EXCLUDED.svg_height,
      svg_viewbox = EXCLUDED.svg_viewbox,
      metadata = EXCLUDED.metadata,
      updated_at = NOW();

  ELSE
    -- Standard PostgreSQL Native Geometry Mode (Fallback when PostGIS extension is absent)
    CREATE TABLE IF NOT EXISTS campus_boundaries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      boundary polygon NOT NULL,
      min_lat DOUBLE PRECISION NOT NULL,
      max_lat DOUBLE PRECISION NOT NULL,
      min_lng DOUBLE PRECISION NOT NULL,
      max_lng DOUBLE PRECISION NOT NULL,
      svg_width INT NOT NULL DEFAULT 1572,
      svg_height INT NOT NULL DEFAULT 2927,
      svg_viewbox VARCHAR(50) NOT NULL DEFAULT '0 0 1572 2927',
      is_active BOOLEAN NOT NULL DEFAULT true,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_campus_boundaries_boundary_gist
      ON campus_boundaries USING GIST (boundary);

    -- Seed canonical campus boundary with native geometric polygon ((lng, lat), ...)
    INSERT INTO campus_boundaries (
      code,
      name,
      description,
      boundary,
      min_lat,
      max_lat,
      min_lng,
      max_lng,
      svg_width,
      svg_height,
      svg_viewbox,
      metadata
    ) VALUES (
      'CANONICAL_CAMPUS',
      'Authoritative Institutional Campus',
      'Authoritative boundary matching the canonical 1572 x 2927 campus SVG vector illustration.',
      polygon '((-122.1765, 37.4330), (-122.1615, 37.4330), (-122.1615, 37.4215), (-122.1765, 37.4215), (-122.1765, 37.4330))',
      37.4215,
      37.4330,
      -122.1765,
      -122.1615,
      1572,
      2927,
      '0 0 1572 2927',
      '{
        "srid": 4326,
        "control_points_count": 8,
        "coordinate_convention": "lat_first_in_api_lng_first_in_postgis",
        "units": "meters"
      }'::jsonb
    ) ON CONFLICT (code) DO UPDATE SET
      boundary = EXCLUDED.boundary,
      min_lat = EXCLUDED.min_lat,
      max_lat = EXCLUDED.max_lat,
      min_lng = EXCLUDED.min_lng,
      max_lng = EXCLUDED.max_lng,
      svg_width = EXCLUDED.svg_width,
      svg_height = EXCLUDED.svg_height,
      svg_viewbox = EXCLUDED.svg_viewbox,
      metadata = EXCLUDED.metadata,
      updated_at = NOW();
  END IF;
END $$;

-- Spatial indexing on spawn points
CREATE INDEX IF NOT EXISTS idx_spawn_points_location_gist 
  ON spawn_points USING GIST (location);

-- Spatial indexing on claims player location
CREATE INDEX IF NOT EXISTS idx_claims_player_location_gist 
  ON claims USING GIST (player_location);
