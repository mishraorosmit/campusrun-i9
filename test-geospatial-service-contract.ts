/**
 * Project I9 — GEO Phase 05 Geospatial Service Contract Verification
 * 
 * Verifies that the public IGeospatialService contract exposes:
 * 1. isInsideCampus(point)
 * 2. distanceMeters(a, b)
 * 3. isMinimumDistanceSatisfied(point, existingPoints, minMeters)
 * 4. nearestSpawn(point)
 * 5. spawnsWithinRadius(point, radius)
 * 6. gpsToSvg(point)
 * 7. svgToGps(point)
 * 
 * Ensures PostGIS implementation is 100% encapsulated behind the service contract.
 */

import { dbPool } from './server/infrastructure/database/pool';
import { config } from './server/config';
import {
  AUTHORITATIVE_CAMPUS_BOUNDS,
  CALIBRATION_CONTROL_POINTS,
  PostgresGeospatialService,
  InvalidCoordinatesError,
  InvalidSvgCoordinatesError,
} from './server/infrastructure/geo';
import { IGeospatialService, GeospatialSpawn } from './server/services';
import { Coordinates, SvgCoordinates } from './server/domain/types';
import crypto from 'crypto';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runContractTests(): Promise<void> {
  console.log('====================================================');
  console.log('  Project I9 — GEO Phase 05 Service Contract Audit');
  console.log('====================================================\n');

  dbPool.initialize({
    connectionString: config.DATABASE_URL,
    max: 5,
    min: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
    statementTimeoutMillis: 5000,
  });

  const geoService: IGeospatialService = new PostgresGeospatialService(dbPool);
  const createdSpawnIds: string[] = [];

  try {
    // -------------------------------------------------------------
    // SECTION 1: isInsideCampus(point)
    // -------------------------------------------------------------
    console.log('--- SECTION 1: isInsideCampus(point) ---');
    {
      const center = AUTHORITATIVE_CAMPUS_BOUNDS.center;
      const inside = await geoService.isInsideCampus(center);
      assert(inside === true, 'Center point is inside campus');

      const northWest = AUTHORITATIVE_CAMPUS_BOUNDS.northWest;
      const cornerInside = await geoService.isInsideCampus(northWest);
      assert(cornerInside === true, 'Boundary perimeter corner is inside campus');

      const farOutside: Coordinates = { lat: 37.4500, lng: -122.1700 };
      const outside = await geoService.isInsideCampus(farOutside);
      assert(outside === false, 'Point outside boundary is rejected');

      // Malformed coordinate rejection
      let threw = false;
      try {
        await geoService.isInsideCampus({ lat: NaN, lng: -122.17 } as any);
      } catch (err) {
        threw = err instanceof InvalidCoordinatesError;
      }
      assert(threw, 'isInsideCampus throws InvalidCoordinatesError for NaN');
    }

    // -------------------------------------------------------------
    // SECTION 2: distanceMeters(a, b)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 2: distanceMeters(a, b) ---');
    {
      const pt1 = AUTHORITATIVE_CAMPUS_BOUNDS.northWest;
      const pt2 = AUTHORITATIVE_CAMPUS_BOUNDS.southWest;

      const dist = geoService.distanceMeters(pt1, pt2);
      assert(typeof dist === 'number' && Number.isFinite(dist), 'distanceMeters returns a finite number');
      assert(dist >= 1270 && dist <= 1290, `Measured distance is in meters: ${dist}m`);

      // Identical coordinates
      const zeroDist = geoService.distanceMeters(pt1, { lat: pt1.lat, lng: pt1.lng });
      assert(zeroDist === 0.0, 'distanceMeters for identical points returns strictly 0.0');

      // Malformed input
      let threw = false;
      try {
        geoService.distanceMeters(pt1, { lat: 100, lng: -122.17 });
      } catch (err) {
        threw = err instanceof InvalidCoordinatesError;
      }
      assert(threw, 'distanceMeters throws InvalidCoordinatesError on out-of-bounds latitude');
    }

    // -------------------------------------------------------------
    // SECTION 3: isMinimumDistanceSatisfied(point, existingPoints, minMeters)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 3: isMinimumDistanceSatisfied(point, existing, minMeters) ---');
    {
      const existing: Coordinates[] = [
        { lat: 37.42800, lng: -122.17000 },
        { lat: 37.43000, lng: -122.17000 },
      ];

      // Too close (15m from first)
      const tooClose: Coordinates = { lat: 37.42813, lng: -122.17000 };
      const failCheck = await geoService.isMinimumDistanceSatisfied(tooClose, existing, 60.0);
      assert(failCheck === false, 'isMinimumDistanceSatisfied returns false for points within 60m');

      // Far enough (100m from all)
      const farEnough: Coordinates = { lat: 37.42900, lng: -122.17100 };
      const passCheck = await geoService.isMinimumDistanceSatisfied(farEnough, existing, 60.0);
      assert(passCheck === true, 'isMinimumDistanceSatisfied returns true when exceeding 60m threshold');

      // Empty existing points
      const emptyCheck = await geoService.isMinimumDistanceSatisfied(tooClose, [], 60.0);
      assert(emptyCheck === true, 'isMinimumDistanceSatisfied returns true for empty existing points list');
    }

    // -------------------------------------------------------------
    // SECTION 4: nearestSpawn(point) & spawnsWithinRadius(point, radius)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 4: nearestSpawn(point) & spawnsWithinRadius(point, radius) ---');
    {
      const testBatchId = crypto.randomUUID();
      const cycleRes = await dbPool.query<any>(`
        INSERT INTO weekly_cycles (cycle_number, starts_at, ends_at, status)
        VALUES (8888, NOW(), NOW() + interval '7 days', 'upcoming')
        ON CONFLICT (cycle_number) DO UPDATE SET status = 'upcoming'
        RETURNING id;
      `);
      const cycleId = cycleRes.rows[0].id;

      await dbPool.query(`
        INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, is_active)
        VALUES ($1, 88888, $2, NOW(), NOW() + interval '1 hour', true)
        ON CONFLICT (batch_number) DO NOTHING;
      `, [testBatchId, cycleId]);

      const testSpawns = [
        { code: 'SVC-SPAWN-ALPHA', lat: 37.43246, lng: -122.17283, name: 'North Hostel Node Alpha' },
        { code: 'SVC-SPAWN-BETA', lat: 37.43060, lng: -122.16824, name: 'Data Science Node Beta' },
      ];

      for (const s of testSpawns) {
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

      // Test nearestSpawn
      const playerPos: Coordinates = { lat: 37.43240, lng: -122.17285 }; // ~7m from Alpha
      const nearest = await geoService.nearestSpawn(playerPos, { batchId: testBatchId });

      assert(nearest !== null, 'nearestSpawn returns a non-null GeospatialSpawn');
      assert(nearest?.code === 'SVC-SPAWN-ALPHA', `nearestSpawn returns mathematically closest spawn (found: ${nearest?.code})`);
      assert(nearest!.distanceMeters < 10.0, `distanceMeters in result is sub-10m (${nearest!.distanceMeters}m)`);
      assert(typeof nearest!.claimRadiusMeters === 'number', 'claimRadiusMeters is a number');

      // Test spawnsWithinRadius
      const within100m = await geoService.spawnsWithinRadius(playerPos, 100.0, { batchId: testBatchId });
      assert(within100m.length === 1, 'spawnsWithinRadius returns 1 spawn within 100m');
      assert(within100m[0].code === 'SVC-SPAWN-ALPHA', 'Spawn within 100m is SVC-SPAWN-ALPHA');

      const within600m = await geoService.spawnsWithinRadius(playerPos, 600.0, { batchId: testBatchId });
      assert(within600m.length === 2, 'spawnsWithinRadius returns both spawns within 600m');
      assert(within600m[0].distanceMeters <= within600m[1].distanceMeters, 'Results sorted by distance ascending');
    }

    // -------------------------------------------------------------
    // SECTION 5: gpsToSvg(point) & svgToGps(point)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 5: gpsToSvg(point) & svgToGps(point) ---');
    {
      const nwGps = AUTHORITATIVE_CAMPUS_BOUNDS.northWest;
      const nwSvg = geoService.gpsToSvg(nwGps);
      assert(nwSvg.x === 0 && nwSvg.y === 0, `gpsToSvg maps NW corner to (0, 0): (${nwSvg.x}, ${nwSvg.y})`);

      const seGps = AUTHORITATIVE_CAMPUS_BOUNDS.southEast;
      const seSvg = geoService.gpsToSvg(seGps);
      assert(
        seSvg.x === 1572 && seSvg.y === 2927,
        `gpsToSvg maps SE corner to (1572, 2927): (${seSvg.x}, ${seSvg.y})`
      );

      const recoveredNw = geoService.svgToGps({ x: 0, y: 0 });
      assert(
        recoveredNw.lat === nwGps.lat && recoveredNw.lng === nwGps.lng,
        'svgToGps maps (0, 0) back to NW coordinates'
      );

      const recoveredSe = geoService.svgToGps({ x: 1572, y: 2927 });
      assert(
        recoveredSe.lat === seGps.lat && recoveredSe.lng === seGps.lng,
        'svgToGps maps (1572, 2927) back to SE coordinates'
      );

      // SVG validation
      let threw = false;
      try {
        geoService.svgToGps({ x: NaN, y: 100 });
      } catch (err) {
        threw = err instanceof InvalidSvgCoordinatesError;
      }
      assert(threw, 'svgToGps throws InvalidSvgCoordinatesError for NaN x');
    }

    console.log('\n====================================================');
    console.log('  🎉 ALL IGeospatialService CONTRACT AUDITS PASSED!');
    console.log('====================================================\n');
  } finally {
    if (createdSpawnIds.length > 0) {
      await dbPool.query(`DELETE FROM spawn_points WHERE id = ANY($1::uuid[]);`, [createdSpawnIds]);
      await dbPool.query(`DELETE FROM spawn_batches WHERE batch_number = 88888;`);
      await dbPool.query(`DELETE FROM weekly_cycles WHERE cycle_number = 8888;`);
      console.log(`[Cleanup] Removed test spawns and cycles.`);
    }
    await dbPool.shutdown();
  }
}

runContractTests().catch((err) => {
  console.error('[Contract Test Failed]:', err);
  process.exit(1);
});
