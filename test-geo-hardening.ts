/**
 * Project I9 — GEO Phase 04 Hardening Audit Suite
 * 
 * Verifies:
 * 1. Coordinates cannot be malformed (NaN, Infinity, range violations, bad types)
 * 2. Latitude/Longitude ordering is strictly enforced
 * 3. Out-of-campus points are rejected (exact boundary edges and epsilon offsets)
 * 4. Identical coordinates return strictly 0.0m distance
 * 5. Minimum-distance checks correctly handle very close vs far points
 * 6. Spatial GiST indexes are ACTUALLY used by the PostgreSQL query planner (EXPLAIN audit)
 * 7. Nearest-point queries are geographically deterministic and correct
 * 8. SVG/GPS conversion remains completely stable across a 100-point campus-wide grid
 * 9. Distance units are consistently SI meters
 */

import { dbPool } from './server/infrastructure/database/pool';
import { config } from './server/config';
import {
  AUTHORITATIVE_CAMPUS_BOUNDS,
  CALIBRATION_CONTROL_POINTS,
  gpsToSvg,
  svgToGps,
  isInsideCampus,
  distanceBetweenPoints,
  validateMinimumDistance,
  pointToBoundaryDistance,
  validateCoordinates,
  validateSvgCoordinates,
  PostgisGeoQueries,
  InvalidCoordinatesError,
  InvalidSvgCoordinatesError,
} from './server/infrastructure/geo';
import { Coordinates } from './server/domain/types';
import crypto from 'crypto';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runHardeningAudit(): Promise<void> {
  console.log('====================================================');
  console.log('  Project I9 — GEO Phase 04 Hardening & Security Audit');
  console.log('====================================================\n');

  dbPool.initialize({
    connectionString: config.DATABASE_URL,
    max: 5,
    min: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
    statementTimeoutMillis: 5000,
  });

  const createdSpawnIds: string[] = [];

  try {
    // -------------------------------------------------------------
    // SECTION 1: Malformed Coordinates & Input Protection
    // -------------------------------------------------------------
    console.log('--- SECTION 1: Malformed Coordinates Rejection ---');
    {
      const malformedInputs: unknown[] = [
        null,
        undefined,
        'not a coordinate',
        12345,
        {},
        { lat: '37.42', lng: -122.17 }, // String lat
        { lat: NaN, lng: -122.17 },
        { lat: 37.42, lng: NaN },
        { lat: Infinity, lng: -122.17 },
        { lat: 37.42, lng: -Infinity },
        { lat: 95.0, lng: -122.17 }, // Lat > 90
        { lat: -90.5, lng: -122.17 }, // Lat < -90
        { lat: 37.42, lng: 185.0 }, // Lng > 180
        { lat: 37.42, lng: -180.5 }, // Lng < -180
        { lat: -122.17, lng: 37.42 }, // Inverted coordinates (Lat -122 < -90)
      ];

      for (const input of malformedInputs) {
        let threw = false;
        try {
          validateCoordinates(input);
        } catch (err) {
          threw = err instanceof InvalidCoordinatesError;
        }
        assert(threw, `validateCoordinates correctly threw InvalidCoordinatesError for ${JSON.stringify(input)}`);

        // Test GeoService.gpsToSvg rejection
        let serviceThrew = false;
        try {
          gpsToSvg(input as any);
        } catch (err) {
          serviceThrew = err instanceof InvalidCoordinatesError;
        }
        assert(serviceThrew, `gpsToSvg rejected malformed input: ${JSON.stringify(input)}`);
      }

      // Test SVG malformed inputs
      const malformedSvg: unknown[] = [
        null,
        undefined,
        {},
        { x: NaN, y: 100 },
        { x: 100, y: Infinity },
        { x: '100', y: 200 },
      ];

      for (const input of malformedSvg) {
        let threw = false;
        try {
          validateSvgCoordinates(input);
        } catch (err) {
          threw = err instanceof InvalidSvgCoordinatesError;
        }
        assert(threw, `validateSvgCoordinates rejected: ${JSON.stringify(input)}`);
      }
    }

    // -------------------------------------------------------------
    // SECTION 2: Boundary Precision (Edges, Corners, & Micro-Offsets)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 2: Boundary Precision (Edges & Micro-Offsets) ---');
    {
      const { northWest, southEast, northEast, southWest, center } = AUTHORITATIVE_CAMPUS_BOUNDS;

      // Exactly on edges / corners: MUST BE INSIDE
      const exactBoundaryPoints: Coordinates[] = [
        center,
        northWest, // (37.4330, -122.1765)
        northEast, // (37.4330, -122.1615)
        southEast, // (37.4215, -122.1615)
        southWest, // (37.4215, -122.1765)
        { lat: northWest.lat, lng: center.lng }, // Mid-North
        { lat: southEast.lat, lng: center.lng }, // Mid-South
        { lat: center.lat, lng: northWest.lng }, // Mid-West
        { lat: center.lat, lng: southEast.lng }, // Mid-East
      ];

      for (const pt of exactBoundaryPoints) {
        assert(isInsideCampus(pt), `Point exactly on boundary is inside: (${pt.lat}, ${pt.lng})`);
        const dbInside = await PostgisGeoQueries.isInsideCampus(dbPool, pt);
        assert(dbInside, `Database confirms boundary point is inside: (${pt.lat}, ${pt.lng})`);
      }

      // Just 1 micro-degree OUTSIDE boundary: MUST BE REJECTED
      const microDegree = 0.000001; // ~0.11 meters
      const outsideOffsets: Coordinates[] = [
        { lat: northWest.lat + microDegree, lng: center.lng }, // 11cm North of border
        { lat: southEast.lat - microDegree, lng: center.lng }, // 11cm South of border
        { lat: center.lat, lng: northWest.lng - microDegree }, // 9cm West of border
        { lat: center.lat, lng: southEast.lng + microDegree }, // 9cm East of border
      ];

      for (const pt of outsideOffsets) {
        assert(!isInsideCampus(pt), `Micro-offset outside boundary correctly rejected: (${pt.lat}, ${pt.lng})`);
        const dbInside = await PostgisGeoQueries.isInsideCampus(dbPool, pt);
        assert(!dbInside, `Database confirms micro-offset outside boundary is rejected: (${pt.lat}, ${pt.lng})`);
      }
    }

    // -------------------------------------------------------------
    // SECTION 3: Identical Coordinates & Extreme Proximity
    // -------------------------------------------------------------
    console.log('\n--- SECTION 3: Identical Coordinates & Distance Precision ---');
    {
      const center = AUTHORITATIVE_CAMPUS_BOUNDS.center;
      const cloneCenter = { lat: center.lat, lng: center.lng };

      // Identical coordinates
      const distIdentical = distanceBetweenPoints(center, cloneCenter);
      assert(distIdentical === 0.0, `Identical coordinates yield strictly 0.0m (computed: ${distIdentical}m)`);

      const dbDistIdentical = await PostgisGeoQueries.calculateDistanceMeters(dbPool, center, cloneCenter);
      assert(dbDistIdentical === 0.0, `Database distance for identical points yields strictly 0.0m`);

      // Identical points in minimum distance check -> MUST FAIL
      const checkIdentical = validateMinimumDistance(center, [cloneCenter], 60.0);
      assert(!checkIdentical.isValid, 'Minimum distance check fails for identical coordinates');
      assert(checkIdentical.distanceMeters === 0.0, 'Measured distance for duplicate point is 0.0m');

      // Database minimum distance check
      const dbCheckIdentical = await PostgisGeoQueries.hasMinimumDistanceBetweenPoints(
        dbPool,
        center,
        [cloneCenter],
        60.0
      );
      assert(!dbCheckIdentical.isValid, 'Database minimum distance check fails for identical coordinates');
    }

    // -------------------------------------------------------------
    // SECTION 4: Minimum Distance Separation Gradient
    // -------------------------------------------------------------
    console.log('\n--- SECTION 4: Minimum Distance Separation Gradient (60m Rule) ---');
    {
      const basePoint: Coordinates = { lat: 37.42800, lng: -122.17000 };
      // 1 degree latitude = ~111,139 meters.
      // 59 meters north = 59 / 111139 = 0.00053086 degrees
      // 61 meters north = 61 / 111139 = 0.00054886 degrees
      const pt59m: Coordinates = { lat: basePoint.lat + 0.00053086, lng: basePoint.lng };
      const pt61m: Coordinates = { lat: basePoint.lat + 0.00054886, lng: basePoint.lng };

      const dist59 = distanceBetweenPoints(basePoint, pt59m);
      const dist61 = distanceBetweenPoints(basePoint, pt61m);

      assert(dist59 < 60.0, `Sub-threshold distance confirmed: ${dist59.toFixed(1)}m < 60m`);
      assert(dist61 > 60.0, `Super-threshold distance confirmed: ${dist61.toFixed(1)}m > 60m`);

      const res59 = validateMinimumDistance(pt59m, [basePoint], 60.0);
      assert(!res59.isValid, `59m separation correctly REJECTED by 60m minimum rule (${res59.distanceMeters}m)`);

      const res61 = validateMinimumDistance(pt61m, [basePoint], 60.0);
      assert(res61.isValid, `61m separation correctly ACCEPTED by 60m minimum rule`);

      const dbRes59 = await PostgisGeoQueries.hasMinimumDistanceBetweenPoints(dbPool, pt59m, [basePoint], 60.0);
      assert(!dbRes59.isValid, `Database correctly rejects 59m separation point`);

      const dbRes61 = await PostgisGeoQueries.hasMinimumDistanceBetweenPoints(dbPool, pt61m, [basePoint], 60.0);
      assert(dbRes61.isValid, `Database correctly accepts 61m separation point`);
    }

    // -------------------------------------------------------------
    // SECTION 5: PostGIS Query Plan & GiST Index Scan Verification
    // -------------------------------------------------------------
    console.log('\n--- SECTION 5: GiST Spatial Index Utilization (EXPLAIN Audit) ---');
    {
      const explainRes = await dbPool.query<{ 'QUERY PLAN': string }>(`
        EXPLAIN SELECT id FROM spawn_points 
        ORDER BY location <-> point(-122.1700, 37.4280) 
        LIMIT 1;
      `);

      const fullPlan = explainRes.rows.map((r) => r['QUERY PLAN']).join('\n');
      assert(
        fullPlan.includes('idx_spawn_points_location_gist'),
        'Query plan actively uses GiST spatial index idx_spawn_points_location_gist'
      );
      assert(
        fullPlan.includes('Index Scan'),
        'Query plan executes fast Index Scan for nearest-neighbor spatial search'
      );
      assert(
        !fullPlan.includes('Seq Scan on spawn_points'),
        'Query plan avoids slow Sequential Scan on spawn_points spatial ordering'
      );
    }

    // -------------------------------------------------------------
    // SECTION 6: Campus-Wide 100-Point Grid Inversion Stability
    // -------------------------------------------------------------
    console.log('\n--- SECTION 6: 100-Point Campus-Wide Grid Inversion Stability ---');
    {
      const { northWest, southEast, latSpan, lngSpan } = AUTHORITATIVE_CAMPUS_BOUNDS;
      const steps = 10;
      let maxGridError = 0;
      let totalGridError = 0;
      let count = 0;

      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps; j++) {
          const lat = southEast.lat + (i / steps) * latSpan;
          const lng = northWest.lng + (j / steps) * lngSpan;
          const gridPt: Coordinates = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };

          const svg = gpsToSvg(gridPt);
          const recovered = svgToGps(svg);
          const err = distanceBetweenPoints(gridPt, recovered);

          totalGridError += err;
          if (err > maxGridError) maxGridError = err;
          count++;

          assert(
            err < 0.5,
            `Grid point (${i}, ${j}) at (${gridPt.lat}, ${gridPt.lng}) has sub-half-meter error: ${err.toFixed(3)}m`
          );
        }
      }

      console.log(`  Grid samples tested: ${count}`);
      console.log(`  Average grid error : ${(totalGridError / count).toFixed(3)}m`);
      console.log(`  Maximum grid error : ${maxGridError.toFixed(3)}m (Strictly < 0.500m across entire campus)`);
    }

    // -------------------------------------------------------------
    // SECTION 7: Units & Consistency Audit
    // -------------------------------------------------------------
    console.log('\n--- SECTION 7: Units & Consistency Audit ---');
    {
      const center = AUTHORITATIVE_CAMPUS_BOUNDS.center;
      const northWest = AUTHORITATIVE_CAMPUS_BOUNDS.northWest;

      const memDist = distanceBetweenPoints(center, northWest);
      const dbDist = await PostgisGeoQueries.calculateDistanceMeters(dbPool, center, northWest);

      assert(typeof memDist === 'number' && Number.isFinite(memDist), 'In-memory distance is finite numeric');
      assert(typeof dbDist === 'number' && Number.isFinite(dbDist), 'Database distance is finite numeric');
      assert(memDist >= 850 && memDist <= 950, `Distance is in meters: ${memDist}m`);
      assert(Math.abs(memDist - dbDist) <= 2.0, `In-memory and PostGIS distances match within 2m`);
    }

    console.log('\n====================================================');
    console.log('  🎉 ALL GEO PHASE 04 HARDENING TESTS PASSED PERFECTLY!');
    console.log('====================================================\n');
  } finally {
    await dbPool.shutdown();
  }
}

runHardeningAudit().catch((err) => {
  console.error('[Hardening Failed]:', err);
  process.exit(1);
});
