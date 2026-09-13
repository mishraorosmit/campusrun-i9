/**
 * Project I9 — GEO Phase 01 & 02 Verification Test Suite
 * 
 * Verifies:
 * 1. Authoritative Campus Boundary & PostGIS Migration 006
 * 2. GPS ↔ SVG Coordinate Transformations across all 8 Calibration Points
 * 3. Round-trip transformation accuracy (within 1 pixel / sub-meter tolerance)
 * 4. Campus Boundary Validation (Server-side PostGIS & In-Memory)
 * 5. GPS Geodesic Distance Calculations against Known Ground-Truth Distances
 * 6. Point-to-Boundary Distance Validation
 * 7. Minimum Distance Between Points Enforcement (60m game rule)
 * 8. GiST-Indexed Spatial Queries: Nearest-Spawn (<->) & Points-Within-Radius (ST_DWithin)
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
  PostgisGeoQueries,
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

async function runTests(): Promise<void> {
  console.log('====================================================');
  console.log('  Project I9 — Geospatial Foundation Audit & Test');
  console.log('====================================================\n');

  // Initialize DB Connection
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
    // SECTION 1: PostGIS Schema & Authoritative Boundary Registration
    // -------------------------------------------------------------
    console.log('--- SECTION 1: Authoritative Campus Boundary in PostgreSQL/PostGIS ---');
    {
      const res = await dbPool.query<any>(`
        SELECT 
          code,
          name,
          min_lat,
          max_lat,
          min_lng,
          max_lng,
          svg_width,
          svg_height,
          svg_viewbox
        FROM campus_boundaries
        WHERE code = 'CANONICAL_CAMPUS';
      `);

      assert(res.rows.length === 1, 'Canonical campus boundary record exists in campus_boundaries table');
      const row = res.rows[0];
      assert(row.min_lat === AUTHORITATIVE_CAMPUS_BOUNDS.southEast.lat, `min_lat matches SE lat (${row.min_lat})`);
      assert(row.max_lat === AUTHORITATIVE_CAMPUS_BOUNDS.northWest.lat, `max_lat matches NW lat (${row.max_lat})`);
      assert(row.min_lng === AUTHORITATIVE_CAMPUS_BOUNDS.northWest.lng, `min_lng matches NW lng (${row.min_lng})`);
      assert(row.max_lng === AUTHORITATIVE_CAMPUS_BOUNDS.southEast.lng, `max_lng matches SE lng (${row.max_lng})`);
      assert(row.svg_width === 1572, 'svg_width is 1572');
      assert(row.svg_height === 2927, 'svg_height is 2927');
      assert(row.svg_viewbox === '0 0 1572 2927', 'svg_viewbox matches canonical viewBox');
    }

    // -------------------------------------------------------------
    // SECTION 2: Calibration & Control Points Verification
    // -------------------------------------------------------------
    console.log('\n--- SECTION 2: Landmark Calibration Points & GPS ↔ SVG Mapping ---');
    {
      assert(CALIBRATION_CONTROL_POINTS.length === 8, '8 authoritative calibration control points are defined');

      for (const ctrl of CALIBRATION_CONTROL_POINTS) {
        // Test gpsToSvg
        const computedSvg = gpsToSvg(ctrl.gps);
        const xDiff = Math.abs(computedSvg.x - ctrl.svg.x);
        const yDiff = Math.abs(computedSvg.y - ctrl.svg.y);

        assert(
          xDiff <= 1 && yDiff <= 1,
          `gpsToSvg matches ${ctrl.code} (${ctrl.name}): computed (${computedSvg.x}, ${computedSvg.y}) vs expected (${ctrl.svg.x}, ${ctrl.svg.y})`
        );

        // Test svgToGps
        const computedGps = svgToGps(ctrl.svg);
        const latDiff = Math.abs(computedGps.lat - ctrl.gps.lat);
        const lngDiff = Math.abs(computedGps.lng - ctrl.gps.lng);

        assert(
          latDiff < 0.0001 && lngDiff < 0.0001,
          `svgToGps matches ${ctrl.code} within 0.0001°: computed {${computedGps.lat}, ${computedGps.lng}} vs expected {${ctrl.gps.lat}, ${ctrl.gps.lng}}`
        );
      }
    }

    // -------------------------------------------------------------
    // SECTION 3: Round-Trip Transformation Invariant
    // -------------------------------------------------------------
    console.log('\n--- SECTION 3: Round-Trip Mathematical Invariance ---');
    {
      const testCoordinates: Coordinates[] = [
        AUTHORITATIVE_CAMPUS_BOUNDS.center,
        { lat: 37.4300, lng: -122.1700 },
        { lat: 37.4250, lng: -122.1650 },
        { lat: 37.4320, lng: -122.1740 },
      ];

      for (const orig of testCoordinates) {
        const svg = gpsToSvg(orig);
        const recovered = svgToGps(svg);
        const distError = distanceBetweenPoints(orig, recovered);

        assert(
          distError < 1.0,
          `Round-trip error for (${orig.lat}, ${orig.lng}) is sub-meter: ${distError.toFixed(3)}m`
        );
      }
    }

    // -------------------------------------------------------------
    // SECTION 4: Authoritative Campus Boundary Validation
    // -------------------------------------------------------------
    console.log('\n--- SECTION 4: Campus Boundary Validation (In-Memory & PostGIS) ---');
    {
      const insidePoints: Coordinates[] = [
        AUTHORITATIVE_CAMPUS_BOUNDS.center,
        { lat: 37.4320, lng: -122.1720 }, // North Hostels
        { lat: 37.4280, lng: -122.1690 }, // Central blocks
        { lat: 37.4230, lng: -122.1640 }, // South Hostels
      ];

      const outsidePoints: Coordinates[] = [
        { lat: 37.4400, lng: -122.1690 }, // Far North
        { lat: 37.4150, lng: -122.1690 }, // Far South
        { lat: 37.4270, lng: -122.1900 }, // Far West
        { lat: 37.4270, lng: -122.1500 }, // Far East
      ];

      for (const pt of insidePoints) {
        assert(isInsideCampus(pt), `GeoService.isInsideCampus correctly identifies inside point (${pt.lat}, ${pt.lng})`);
        const dbInside = await PostgisGeoQueries.isInsideCampus(dbPool, pt);
        assert(dbInside, `PostgisGeoQueries.isInsideCampus confirms inside point (${pt.lat}, ${pt.lng})`);
      }

      for (const pt of outsidePoints) {
        assert(!isInsideCampus(pt), `GeoService.isInsideCampus correctly rejects outside point (${pt.lat}, ${pt.lng})`);
        const dbInside = await PostgisGeoQueries.isInsideCampus(dbPool, pt);
        assert(!dbInside, `PostgisGeoQueries.isInsideCampus confirms outside point (${pt.lat}, ${pt.lng})`);
      }
    }

    // -------------------------------------------------------------
    // SECTION 5: GPS Distance Calculations & Ground-Truth Benchmarks
    // -------------------------------------------------------------
    console.log('\n--- SECTION 5: Geodetic Distance Calculations & Ground Truth ---');
    {
      const { northWest, southEast, northEast, southWest } = AUTHORITATIVE_CAMPUS_BOUNDS;

      // 1. North-to-South span (lat span = 0.0115 degrees)
      const nsDistMemory = distanceBetweenPoints(northWest, southWest);
      const nsDistDb = await PostgisGeoQueries.calculateDistanceMeters(dbPool, northWest, southWest);
      assert(
        nsDistMemory >= 1270 && nsDistMemory <= 1290,
        `North-to-South campus span is ~1,278m (computed: ${nsDistMemory}m)`
      );
      assert(
        Math.abs(nsDistMemory - nsDistDb) <= 5.0,
        `Database distance matches in-memory distance within 5m tolerance (DB: ${nsDistDb}m)`
      );

      // 2. West-to-East span (lng span = 0.0150 degrees at lat 37.4330)
      const weDistMemory = distanceBetweenPoints(northWest, northEast);
      assert(
        weDistMemory >= 1315 && weDistMemory <= 1335,
        `West-to-East campus span is ~1,324m (computed: ${weDistMemory}m)`
      );

      // 3. Diagonal span (NW to SE)
      const diagonalDist = distanceBetweenPoints(northWest, southEast);
      assert(
        diagonalDist >= 1830 && diagonalDist <= 1850,
        `Diagonal campus span is ~1,840m (computed: ${diagonalDist}m)`
      );
    }

    // -------------------------------------------------------------
    // SECTION 6: Point-to-Boundary Distance Validation
    // -------------------------------------------------------------
    console.log('\n--- SECTION 6: Point-to-Boundary Distance Validation ---');
    {
      const center = AUTHORITATIVE_CAMPUS_BOUNDS.center;
      const centerValidation = await PostgisGeoQueries.validatePointToBoundary(dbPool, center);
      assert(centerValidation.isInside === true, 'Center point is inside boundary');
      assert(
        centerValidation.distanceToBoundaryMeters >= 600 && centerValidation.distanceToBoundaryMeters <= 700,
        `Center point is ~639m from boundary edge (${centerValidation.distanceToBoundaryMeters.toFixed(1)}m)`
      );

      const outsidePt: Coordinates = { lat: 37.4350, lng: -122.1765 }; // 0.002° North of NW gate
      const outsideValidation = await PostgisGeoQueries.validatePointToBoundary(dbPool, outsidePt);
      assert(outsideValidation.isInside === false, 'Outside point is recognized as outside');
      assert(
        outsideValidation.distanceToBoundaryMeters >= 210 && outsideValidation.distanceToBoundaryMeters <= 230,
        `Distance to boundary for outside point is ~222m (${outsideValidation.distanceToBoundaryMeters.toFixed(1)}m)`
      );
    }

    // -------------------------------------------------------------
    // SECTION 7: Minimum Distance Between Points Enforcement
    // -------------------------------------------------------------
    console.log('\n--- SECTION 7: Minimum Distance Between Points (60m Rule) ---');
    {
      const existingSpawns: Coordinates[] = [
        { lat: 37.42800, lng: -122.17000 },
        { lat: 37.42900, lng: -122.17000 }, // ~111m North
      ];

      // Too close (20m away)
      const tooClose: Coordinates = { lat: 37.42815, lng: -122.17000 };
      const closeCheck = validateMinimumDistance(tooClose, existingSpawns, 60.0);
      assert(!closeCheck.isValid, 'validateMinimumDistance rejects point closer than 60m');
      assert(
        closeCheck.distanceMeters! < 60.0,
        `Violating distance correctly measured: ${closeCheck.distanceMeters?.toFixed(1)}m`
      );

      // Sufficiently far (80m away)
      const farEnough: Coordinates = { lat: 37.42850, lng: -122.17100 };
      const farCheck = validateMinimumDistance(farEnough, existingSpawns, 60.0);
      assert(farCheck.isValid, 'validateMinimumDistance accepts point exceeding 60m minimum distance');

      // Database version
      const dbCloseCheck = await PostgisGeoQueries.hasMinimumDistanceBetweenPoints(
        dbPool,
        tooClose,
        existingSpawns,
        60.0
      );
      assert(!dbCloseCheck.isValid, 'PostgisGeoQueries.hasMinimumDistanceBetweenPoints rejects point closer than 60m');
    }

    // -------------------------------------------------------------
    // SECTION 8: GiST-Indexed Spatial Queries (Nearest-Spawn & Radius)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 8: Spatial Queries (Nearest-Spawn & Within-Radius) ---');
    {
      const testBatchId = crypto.randomUUID();
      const cycleRes = await dbPool.query<any>(`
        INSERT INTO weekly_cycles (cycle_number, starts_at, ends_at, status)
        VALUES (9999, NOW(), NOW() + interval '7 days', 'upcoming')
        ON CONFLICT (cycle_number) DO UPDATE SET status = 'upcoming'
        RETURNING id;
      `);
      const cycleId = cycleRes.rows[0].id;

      await dbPool.query(`
        INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, is_active)
        VALUES ($1, 99999, $2, NOW(), NOW() + interval '1 hour', true)
        ON CONFLICT (batch_number) DO NOTHING;
      `, [testBatchId, cycleId]);

      // Seed 3 test spawn points in database
      // Spawn A: BH-7 Courtyard (lat: 37.43246, lng: -122.17283)
      // Spawn B: Center of Data Science (lat: 37.43060, lng: -122.16824)
      // Spawn C: D-Block Plaza (lat: 37.42805, lng: -122.17335)
      const spawns = [
        { code: 'TEST-SPAWN-A', lat: 37.43246, lng: -122.17283, name: 'BH-7 Courtyard Node' },
        { code: 'TEST-SPAWN-B', lat: 37.43060, lng: -122.16824, name: 'Data Science Node' },
        { code: 'TEST-SPAWN-C', lat: 37.42805, lng: -122.17335, name: 'D-Block Plaza Node' },
      ];

      for (const s of spawns) {
        const id = crypto.randomUUID();
        createdSpawnIds.push(id);
        await dbPool.query(`
          INSERT INTO spawn_points (
            id, code, batch_id, title, location, svg_x, svg_y, status, enabled, points, claim_radius_meters
          ) VALUES (
            $1, $2, $3, $4, point($5, $6), 100, 100, 'active', true, 100, 25.0
          );
        `, [id, s.code, testBatchId, s.name, s.lng, s.lat]);
      }

      console.log('  Seeded 3 test spawns with GiST indexed point geometry.');

      // 1. Test Nearest-Spawn from player location near Spawn A
      const playerNearA: Coordinates = { lat: 37.43250, lng: -122.17280 }; // ~6m from Spawn A
      const nearestA = await PostgisGeoQueries.findNearestSpawn(dbPool, playerNearA, { batchId: testBatchId });
      assert(nearestA !== null, 'findNearestSpawn returns a result');
      assert(nearestA?.code === 'TEST-SPAWN-A', `Nearest spawn to BH-7 is TEST-SPAWN-A (found: ${nearestA?.code})`);
      assert(nearestA!.distanceMeters < 10.0, `Distance to nearest spawn is sub-10m (${nearestA!.distanceMeters.toFixed(1)}m)`);

      // 2. Test Nearest-Spawn from player location near Spawn C
      const playerNearC: Coordinates = { lat: 37.42800, lng: -122.17340 }; // ~8m from Spawn C
      const nearestC = await PostgisGeoQueries.findNearestSpawn(dbPool, playerNearC, { batchId: testBatchId });
      assert(nearestC?.code === 'TEST-SPAWN-C', `Nearest spawn to D-Block is TEST-SPAWN-C (found: ${nearestC?.code})`);

      // 3. Test findSpawnsWithinRadius:
      // Search radius 300m from Spawn A -> should include Spawn A, but NOT Spawn B or C (>400m away)
      const radiusSpawnsSmall = await PostgisGeoQueries.findSpawnsWithinRadius(
        dbPool,
        playerNearA,
        300.0,
        { batchId: testBatchId }
      );
      assert(radiusSpawnsSmall.length === 1, `Radius 300m returns exactly 1 spawn (found: ${radiusSpawnsSmall.length})`);
      assert(radiusSpawnsSmall[0].code === 'TEST-SPAWN-A', 'Single returned spawn is TEST-SPAWN-A');

      // Search radius 600m from Center -> should find all 3 spawns
      const radiusSpawnsLarge = await PostgisGeoQueries.findSpawnsWithinRadius(
        dbPool,
        AUTHORITATIVE_CAMPUS_BOUNDS.center,
        700.0,
        { batchId: testBatchId }
      );
      assert(
        radiusSpawnsLarge.length === 3,
        `Radius 700m from center includes all 3 seeded test spawns (found: ${radiusSpawnsLarge.length})`
      );
      assert(
        radiusSpawnsLarge[0].distanceMeters <= radiusSpawnsLarge[1].distanceMeters,
        'Radius results are ordered by distance ascending'
      );
    }

    console.log('\n====================================================');
    console.log('  🎉 ALL GEOSPATIAL FOUNDATION & POSTGIS TESTS PASSED!');
    console.log('====================================================\n');
  } finally {
    // Cleanup seeded spawns
    if (createdSpawnIds.length > 0) {
      await dbPool.query(`DELETE FROM spawn_points WHERE id = ANY($1::uuid[]);`, [createdSpawnIds]);
      await dbPool.query(`DELETE FROM spawn_batches WHERE batch_number = 99999;`);
      await dbPool.query(`DELETE FROM weekly_cycles WHERE cycle_number = 9999;`);
      console.log(`[Cleanup] Removed ${createdSpawnIds.length} test spawn points and test cycles.`);
    }
    await dbPool.shutdown();
  }
}

runTests().catch((err) => {
  console.error('[Test Failed]:', err);
  process.exit(1);
});
