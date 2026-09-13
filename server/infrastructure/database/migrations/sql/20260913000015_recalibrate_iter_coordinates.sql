-- Recalibrate legacy Stanford-like spawn and zone coordinates to ITER, SOA University.
-- Existing rows store legacy SVG coordinates in the 1572 x 2927 space.
-- The expressions below apply the measured map correction, then invert the
-- calibrated direct GPS projection used by the frontend.

WITH spawn_map AS (
  SELECT
    id,
    (1.1975579055085759 * svg_x + 0.04212984424152487 * svg_y + 9.992779773265918) AS x,
    (0.05574502142079761 * svg_x + 1.2537053857711715 * svg_y - 44.504117565456845) AS y
  FROM spawn_points
), spawn_gps AS (
  SELECT
    id,
    ((x - 854.0601054134638) * -0.3366389296906753 - (y - 1384.771642581982) * 6.109566269317218) /
      (-0.04877298402879626 * -0.3366389296906753 - 6.109566269317218 * -6.488199724926953) AS d_lat,
    (-0.04877298402879626 * (y - 1384.771642581982) - -6.488199724926953 * (x - 854.0601054134638)) /
      (-0.04877298402879626 * -0.3366389296906753 - 6.109566269317218 * -6.488199724926953) AS d_lng,
    x,
    y
  FROM spawn_map
)
UPDATE spawn_points s
SET
  lat = ROUND((20.2485 + d_lat / 100000.0)::numeric, 7),
  lng = ROUND((85.8010 + d_lng / 100000.0)::numeric, 7),
  svg_x = ROUND(x)::integer,
  svg_y = ROUND(y)::integer,
  location = ST_SetSRID(ST_MakePoint(85.8010 + d_lng / 100000.0, 20.2485 + d_lat / 100000.0), 4326)::geography,
  updated_at = NOW()
FROM spawn_gps g
WHERE s.id = g.id;

WITH zone_map AS (
  SELECT
    id,
    (1.1975579055085759 * center_svg_x + 0.04212984424152487 * center_svg_y + 9.992779773265918) AS x,
    (0.05574502142079761 * center_svg_x + 1.2537053857711715 * center_svg_y - 44.504117565456845) AS y
  FROM campus_zones
), zone_gps AS (
  SELECT
    id,
    ((x - 854.0601054134638) * -0.3366389296906753 - (y - 1384.771642581982) * 6.109566269317218) /
      (-0.04877298402879626 * -0.3366389296906753 - 6.109566269317218 * -6.488199724926953) AS d_lat,
    (-0.04877298402879626 * (y - 1384.771642581982) - -6.488199724926953 * (x - 854.0601054134638)) /
      (-0.04877298402879626 * -0.3366389296906753 - 6.109566269317218 * -6.488199724926953) AS d_lng,
    x,
    y
  FROM zone_map
)
UPDATE campus_zones z
SET
  center_lat = ROUND((20.2485 + d_lat / 100000.0)::numeric, 7),
  center_lng = ROUND((85.8010 + d_lng / 100000.0)::numeric, 7),
  center_svg_x = ROUND(x)::integer,
  center_svg_y = ROUND(y)::integer,
  updated_at = NOW()
FROM zone_gps g
WHERE z.id = g.id;

UPDATE campus_boundaries
SET
  min_lat = 20.2435,
  max_lat = 20.2520,
  min_lng = 85.7975,
  max_lng = 85.8045,
  svg_width = 1991,
  svg_height = 3704,
  svg_viewbox = '0 0 1991 3704',
  boundary = ST_GeogFromText('POLYGON((85.7975 20.2520, 85.8045 20.2520, 85.8045 20.2435, 85.7975 20.2435, 85.7975 20.2520))'),
  updated_at = NOW()
WHERE code = 'CANONICAL_CAMPUS';
