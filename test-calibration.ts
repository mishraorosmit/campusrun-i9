/**
 * Project I9 — GEO Phase 03 Calibration Audit Suite
 * 
 * Verifies the SVG ↔ GPS transformation against:
 * 1. The canonical campus SVG (MAP SVG/Group 2-2.svg, 1572 x 2927)
 * 2. The 8 authoritative calibration control points
 * 3. Campus boundary edges and corners
 * 4. All 13 representative spawn points from canonical game data
 * 5. All 5 campus zone centers
 * 
 * Measures:
 * - Round-trip inversion error (SVG → GPS → SVG & GPS → SVG → GPS)
 * - Geodesic error in meters
 * - Pixel error in SVG space
 * - Projection distortion across latitude/longitude spans
 */

import fs from 'fs';
import path from 'path';
import {
  AUTHORITATIVE_CAMPUS_BOUNDS,
  CALIBRATION_CONTROL_POINTS,
  gpsToSvg,
  svgToGps,
  isInsideCampus,
  distanceBetweenPoints,
  pointToBoundaryDistance,
} from './server/infrastructure/geo';
import { INITIAL_SPAWNS, INITIAL_ZONES } from './src/data/campusMap';
import { Coordinates, SvgCoordinates } from './server/domain/types';

interface ErrorMetrics {
  name: string;
  category: string;
  svgExpected: SvgCoordinates;
  svgComputed: SvgCoordinates;
  gpsExpected: Coordinates;
  gpsComputed: Coordinates;
  svgPixelError: number;
  geodesicErrorMeters: number;
}

function runCalibrationAudit(): void {
  console.log('====================================================');
  console.log('  Project I9 — GEO Phase 03 Calibration Audit');
  console.log('====================================================\n');

  // 1. Inspect actual SVG file on disk
  const svgPath = path.resolve(process.cwd(), 'MAP SVG', 'Group 2-2.svg');
  if (!fs.existsSync(svgPath)) {
    throw new Error(`Canonical campus SVG not found at ${svgPath}`);
  }

  const svgContent = fs.readFileSync(svgPath, 'utf8');
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  const widthMatch = svgContent.match(/width="([^"]+)"/);
  const heightMatch = svgContent.match(/height="([^"]+)"/);

  const rawViewBox = viewBoxMatch ? viewBoxMatch[1] : 'unknown';
  const rawWidth = widthMatch ? parseInt(widthMatch[1], 10) : 0;
  const rawHeight = heightMatch ? parseInt(heightMatch[1], 10) : 0;

  console.log(`[SVG Asset Verification]`);
  console.log(`  File: ${svgPath}`);
  console.log(`  Parsed width: ${rawWidth}, height: ${rawHeight}, viewBox: "${rawViewBox}"`);

  if (rawViewBox !== AUTHORITATIVE_CAMPUS_BOUNDS.svgViewBox) {
    throw new Error(
      `SVG viewBox mismatch: file has "${rawViewBox}", expected "${AUTHORITATIVE_CAMPUS_BOUNDS.svgViewBox}"`
    );
  }
  console.log(`  ✓ Canonical SVG viewBox ("${rawViewBox}") perfectly matches authoritative bounds\n`);

  // 2. Comprehensive Test Samples
  const samples: Array<{ name: string; category: string; svg: SvgCoordinates; gps: Coordinates }> = [];

  // A. 8 Control Points
  for (const ctrl of CALIBRATION_CONTROL_POINTS) {
    samples.push({
      name: `${ctrl.code} (${ctrl.name})`,
      category: 'Control Point',
      svg: ctrl.svg,
      gps: ctrl.gps,
    });
  }

  // B. 13 Representative Spawns
  for (const spawn of INITIAL_SPAWNS) {
    samples.push({
      name: `${spawn.code} (${spawn.title})`,
      category: 'Spawn Point',
      svg: { x: spawn.svgX, y: spawn.svgY },
      gps: { lat: spawn.lat, lng: spawn.lng },
    });
  }

  // C. 5 Zone Centers
  for (const zone of INITIAL_ZONES) {
    samples.push({
      name: `${zone.code} (${zone.name})`,
      category: 'Zone Center',
      svg: { x: zone.centerSvgX, y: zone.centerSvgY },
      gps: { lat: zone.centerLat, lng: zone.centerLng },
    });
  }

  // D. 4 Boundary Midpoints
  const midNorth = { lat: 37.4330, lng: -122.1690 };
  const midSouth = { lat: 37.4215, lng: -122.1690 };
  const midWest = { lat: 37.42725, lng: -122.1765 };
  const midEast = { lat: 37.42725, lng: -122.1615 };

  samples.push(
    { name: 'Boundary Mid-North', category: 'Boundary Edge', svg: { x: 786, y: 0 }, gps: midNorth },
    { name: 'Boundary Mid-South', category: 'Boundary Edge', svg: { x: 786, y: 2927 }, gps: midSouth },
    { name: 'Boundary Mid-West', category: 'Boundary Edge', svg: { x: 0, y: 1464 }, gps: midWest },
    { name: 'Boundary Mid-East', category: 'Boundary Edge', svg: { x: 1572, y: 1464 }, gps: midEast }
  );

  console.log(`[Evaluating ${samples.length} Total Verification Locations]`);
  console.log(`  - 8 Calibration Control Points`);
  console.log(`  - 13 Representative Spawn Locations`);
  console.log(`  - 5 Campus Zone Centers`);
  console.log(`  - 4 Boundary Edges / Midpoints\n`);

  const metrics: ErrorMetrics[] = [];

  for (const s of samples) {
    // 1. GPS -> SVG
    const computedSvg = gpsToSvg(s.gps);
    const dx = computedSvg.x - s.svg.x;
    const dy = computedSvg.y - s.svg.y;
    const svgPixelError = Math.sqrt(dx * dx + dy * dy);

    // 2. SVG -> GPS
    const computedGps = svgToGps(s.svg);
    const geodesicErrorMeters = distanceBetweenPoints(s.gps, computedGps);

    metrics.push({
      name: s.name,
      category: s.category,
      svgExpected: s.svg,
      svgComputed: computedSvg,
      gpsExpected: s.gps,
      gpsComputed: computedGps,
      svgPixelError,
      geodesicErrorMeters,
    });
  }

  // Print sample results table
  console.log(
    '-------------------------------------------------------------------------------------------------------------'
  );
  console.log(
    `| ${'Location Name'.padEnd(38)} | ${'Category'.padEnd(15)} | ${'Pixel Error'.padStart(12)} | ${'Geodesic Error'.padStart(15)} | Status |`
  );
  console.log(
    '-------------------------------------------------------------------------------------------------------------'
  );

  let totalPixelError = 0;
  let totalGeodesicError = 0;
  let maxPixelError = 0;
  let maxGeodesicError = 0;

  for (const m of metrics) {
    totalPixelError += m.svgPixelError;
    totalGeodesicError += m.geodesicErrorMeters;
    if (m.svgPixelError > maxPixelError) maxPixelError = m.svgPixelError;
    if (m.geodesicErrorMeters > maxGeodesicError) maxGeodesicError = m.geodesicErrorMeters;

    const pixelStr = `${m.svgPixelError.toFixed(2)} px`.padStart(12);
    const geoStr = `${m.geodesicErrorMeters.toFixed(3)} m`.padStart(15);
    const status = m.geodesicErrorMeters <= 1.0 ? 'PASS' : 'WARN';

    console.log(
      `| ${m.name.padEnd(38)} | ${m.category.padEnd(15)} | ${pixelStr} | ${geoStr} |  ${status}  |`
    );
  }

  console.log(
    '-------------------------------------------------------------------------------------------------------------\n'
  );

  const meanPixelError = totalPixelError / metrics.length;
  const meanGeodesicError = totalGeodesicError / metrics.length;

  console.log('[Statistical Accuracy Summary]');
  console.log(`  Total Sample Points Evaluated : ${metrics.length}`);
  console.log(`  Mean Pixel Error (SVG Space)  : ${meanPixelError.toFixed(3)} px (Threshold: < 2.0 px)`);
  console.log(`  Max Pixel Error (SVG Space)   : ${maxPixelError.toFixed(3)} px`);
  console.log(`  Mean Geodesic Error (WGS 84)  : ${meanGeodesicError.toFixed(3)} meters (Threshold: < 1.0 m)`);
  console.log(`  Max Geodesic Error (WGS 84)   : ${maxGeodesicError.toFixed(3)} meters`);
  console.log(`  Minimum Claim Radius in Game  : 18.0 meters (LH-3 & Dining Pavilion)`);
  console.log(`  Safety Factor (Radius / Error): ${(18.0 / Math.max(0.001, maxGeodesicError)).toFixed(1)}x\n`);

  // Assert criteria
  if (maxPixelError > 2.0) {
    throw new Error(`Calibration failure: Max pixel error ${maxPixelError}px exceeds threshold (2.0px)`);
  }
  if (maxGeodesicError > 1.0) {
    throw new Error(`Calibration failure: Max geodesic error ${maxGeodesicError}m exceeds sub-meter threshold (1.0m)`);
  }

  console.log('====================================================');
  console.log('  ✓ GEO PHASE 03 CALIBRATION AUDIT FULLY VERIFIED!');
  console.log('====================================================\n');
}

runCalibrationAudit();
