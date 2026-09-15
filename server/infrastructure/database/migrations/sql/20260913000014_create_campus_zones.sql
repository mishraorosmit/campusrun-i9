-- ============================================================================
-- Migration: 20260913000009_create_campus_zones.sql
-- Description: Create campus_zones table and seed canonical zones
-- ============================================================================

CREATE TABLE IF NOT EXISTS campus_zones (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  svg_path TEXT NOT NULL,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  center_svg_x INT NOT NULL,
  center_svg_y INT NOT NULL,
  active_spawns_count INT NOT NULL DEFAULT 0,
  total_points_available INT NOT NULL DEFAULT 0,
  color VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campus_zones_code ON campus_zones (code);

-- Seed canonical campus zones
INSERT INTO campus_zones (
  id,
  name,
  code,
  description,
  svg_path,
  center_lat,
  center_lng,
  center_svg_x,
  center_svg_y,
  active_spawns_count,
  total_points_available,
  color
) VALUES
(
  'zone-north-hostels',
  'North Hostel Enclave',
  'NHE-01',
  'Hostel residences BH-1 through BH-7, dining commons and north breezeway.',
  'M 200 20 L 750 20 L 750 480 L 180 480 Z',
  37.432018,
  -122.172205,
  450,
  250,
  4,
  850,
  '#F16321'
),
(
  'zone-academic-core',
  'Academic Quad & Tech Hub',
  'AQ-02',
  'Center of Data Science, Academic Blocks, and Research Concourses.',
  'M 250 500 L 1100 500 L 1100 980 L 250 980 Z',
  37.430095,
  -122.170057,
  675,
  740,
  5,
  1100,
  '#F5844C'
),
(
  'zone-central-blocks',
  'Central Department Complex',
  'CDC-03',
  'Lecture Halls LH-1 to LH-4, C-Block, D-Block, and Open Lawns.',
  'M 180 1000 L 950 1000 L 950 1550 L 180 1550 Z',
  37.427993,
  -122.171155,
  560,
  1275,
  4,
  780,
  '#FFB088'
),
(
  'zone-sports-arena',
  'Athletics & Sports Complex',
  'ASC-04',
  'Cricket Grounds, Football Courts, Indoor Stadium, and Recreation Gym.',
  'M 260 1560 L 1300 1560 L 1300 2150 L 260 2150 Z',
  37.425715,
  -122.169055,
  780,
  1855,
  5,
  1250,
  '#38B2AC'
),
(
  'zone-south-hostels',
  'South Residential Valley',
  'SRV-05',
  'Hostels BH-8 to BH-12, botanical gardens, and south athletics oval.',
  'M 600 2050 L 1500 2050 L 1500 2880 L 600 2880 Z',
  37.423319,
  -122.166479,
  1050,
  2465,
  3,
  620,
  '#9F7AEA'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  svg_path = EXCLUDED.svg_path,
  center_lat = EXCLUDED.center_lat,
  center_lng = EXCLUDED.center_lng,
  center_svg_x = EXCLUDED.center_svg_x,
  center_svg_y = EXCLUDED.center_svg_y,
  active_spawns_count = EXCLUDED.active_spawns_count,
  total_points_available = EXCLUDED.total_points_available,
  color = EXCLUDED.color,
  updated_at = NOW();
