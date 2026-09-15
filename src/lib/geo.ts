import * as turf from '@turf/turf';
import { SpawnPoint } from '../types';

/**
 * Campus Geo Reference Bounds
 * Geographic bounding box mapping to the campus SVG coordinate system (1572 x 2927)
 */
const CAMPUS_LINK_WIDTH = 1580;
const CAMPUS_LINK_HEIGHT = 2891;
const SVG_WIDTH = 1991;
const SVG_HEIGHT = 3704;
const SCALE_X = SVG_WIDTH / CAMPUS_LINK_WIDTH;
const SCALE_Y = SVG_HEIGHT / CAMPUS_LINK_HEIGHT;

export const CAMPUS_GEO_BOUNDS = {
  northWest: { lat: 20.2520, lng: 85.7975 },
  southEast: { lat: 20.2435, lng: 85.8045 },
  svgWidth: SVG_WIDTH,
  svgHeight: SVG_HEIGHT,
};

const CAMPUS_LINK_ANCHORS = [
  [20.250620, 85.801050, 676, 48], [20.250403, 85.800364, 389, 138],
  [20.250319, 85.800819, 590, 180], [20.249985, 85.800832, 572, 366],
  [20.249472, 85.800603, 437, 650], [20.249447, 85.801393, 869, 614],
  [20.249177, 85.801115, 709, 766], [20.249192, 85.801627, 941, 794],
  [20.248795, 85.801163, 716, 961], [20.248375, 85.801274, 764, 1177],
  [20.248446, 85.801871, 1053, 1213], [20.248166, 85.802406, 1337, 1308],
  [20.247555, 85.801300, 871, 1485], [20.247594, 85.800515, 394, 1614],
  [20.247100, 85.800700, 583, 1836], [20.246450, 85.801350, 847, 2143],
  [20.245800, 85.802300, 1302, 2436], [20.245450, 85.802400, 1451, 2637],
  [20.245050, 85.802100, 1344, 2830],
];

function solveAffineTransform() {
  const centerLat = 20.2485;
  const centerLng = 85.8010;
  const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const xVector = [0, 0, 0];
  const yVector = [0, 0, 0];
  for (const [lat, lng, x, y] of CAMPUS_LINK_ANCHORS) {
    const row = [lat - centerLat, lng - centerLng, 1];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) matrix[i][j] += row[i] * row[j];
      xVector[i] += row[i] * x;
      yVector[i] += row[i] * y;
    }
  }
  const solve = (input: number[][], vector: number[]) => {
    const m = input.map((row, index) => [...row, vector[index]]);
    for (let pivot = 0; pivot < 3; pivot += 1) {
      const pivotRow = m.slice(pivot).reduce((best, row, index) =>
        Math.abs(row[pivot]) > Math.abs(m[best][pivot]) ? index + pivot : best, pivot);
      [m[pivot], m[pivotRow]] = [m[pivotRow], m[pivot]];
      const divisor = m[pivot][pivot];
      for (let column = pivot; column < 4; column += 1) m[pivot][column] /= divisor;
      for (let row = 0; row < 3; row += 1) {
        if (row === pivot) continue;
        const factor = m[row][pivot];
        for (let column = pivot; column < 4; column += 1) m[row][column] -= factor * m[pivot][column];
      }
    }
    return [m[0][3], m[1][3], m[2][3]];
  };
  return { x: solve(matrix, xVector), y: solve(matrix, yVector), centerLat, centerLng };
}

export const CAMPUS_LINK_AFFINE = solveAffineTransform();
const AFFINE = CAMPUS_LINK_AFFINE;

// Shared buildings measured in campus-rmap1.svg and CampusLink's coordinate map.
// This second transform corrects the new artwork's non-uniform geometry.
const MAP_CONTROL_POINTS = [
  [389, 138, 480, 150],
  [590, 180, 735, 198],
  [869, 614, 1066, 792],
  [394, 1614, 548, 2005],
  [1302, 2436, 1675, 3076],
];

function solveMapTransform() {
  const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const xVector = [0, 0, 0];
  const yVector = [0, 0, 0];
  for (const [x, y, targetX, targetY] of MAP_CONTROL_POINTS) {
    const row = [x, y, 1];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) matrix[i][j] += row[i] * row[j];
      xVector[i] += row[i] * targetX;
      yVector[i] += row[i] * targetY;
    }
  }
  const solve = (input: number[][], vector: number[]) => {
    const m = input.map((row, index) => [...row, vector[index]]);
    for (let pivot = 0; pivot < 3; pivot += 1) {
      const divisor = m[pivot][pivot];
      for (let column = pivot; column < 4; column += 1) m[pivot][column] /= divisor;
      for (let row = 0; row < 3; row += 1) {
        if (row === pivot) continue;
        const factor = m[row][pivot];
        for (let column = pivot; column < 4; column += 1) m[row][column] -= factor * m[pivot][column];
      }
    }
    return [m[0][3], m[1][3], m[2][3]];
  };
  return { x: solve(matrix, xVector), y: solve(matrix, yVector) };
}

export const MAP_AFFINE = solveMapTransform();

const GPS_TO_NEW_MAP_POINTS = [
  [20.250403, 85.800364, 480, 150],
  [20.250319, 85.800819, 735, 198],
  [20.249447, 85.801393, 1066, 792],
  [20.247594, 85.800515, 548, 2005],
  [20.245800, 85.802300, 1675, 3076],
];

function solveDirectGpsTransform() {
  const centerLat = 20.2485;
  const centerLng = 85.8010;
  const coordinateScale = 100000;
  const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const xVector = [0, 0, 0];
  const yVector = [0, 0, 0];
  for (const [lat, lng, x, y] of GPS_TO_NEW_MAP_POINTS) {
    const row = [(lat - centerLat) * coordinateScale, (lng - centerLng) * coordinateScale, 1];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) matrix[i][j] += row[i] * row[j];
      xVector[i] += row[i] * x;
      yVector[i] += row[i] * y;
    }
  }
  const solve = (input: number[][], vector: number[]) => {
    const m = input.map((row, index) => [...row, vector[index]]);
    for (let pivot = 0; pivot < 3; pivot += 1) {
      const divisor = m[pivot][pivot];
      for (let column = pivot; column < 4; column += 1) m[pivot][column] /= divisor;
      for (let row = 0; row < 3; row += 1) {
        if (row === pivot) continue;
        const factor = m[row][pivot];
        for (let column = pivot; column < 4; column += 1) m[row][column] -= factor * m[pivot][column];
      }
    }
    return [m[0][3], m[1][3], m[2][3]];
  };
  return { x: solve(matrix, xVector), y: solve(matrix, yVector), centerLat, centerLng, coordinateScale };
}

export const DIRECT_GPS_AFFINE = solveDirectGpsTransform();
export function legacyCoordinatesToSvg(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(MAP_AFFINE.x[0] * x + MAP_AFFINE.x[1] * y + MAP_AFFINE.x[2]),
    y: Math.round(MAP_AFFINE.y[0] * x + MAP_AFFINE.y[1] * y + MAP_AFFINE.y[2]),
  };
}

/**
 * Maps GPS Latitude and Longitude to SVG coordinate space
 */
export function gpsToSvg(lat: number, lng: number): { x: number; y: number } {
  const dLat = (lat - DIRECT_GPS_AFFINE.centerLat) * DIRECT_GPS_AFFINE.coordinateScale;
  const dLng = (lng - DIRECT_GPS_AFFINE.centerLng) * DIRECT_GPS_AFFINE.coordinateScale;
  return {
    x: Math.round(DIRECT_GPS_AFFINE.x[0] * dLat + DIRECT_GPS_AFFINE.x[1] * dLng + DIRECT_GPS_AFFINE.x[2]),
    y: Math.round(DIRECT_GPS_AFFINE.y[0] * dLat + DIRECT_GPS_AFFINE.y[1] * dLng + DIRECT_GPS_AFFINE.y[2]),
  };
}

/**
 * Maps SVG coordinate space back to GPS Latitude and Longitude
 */
export function svgToGps(x: number, y: number): { lat: number; lng: number } {
  const determinant = DIRECT_GPS_AFFINE.x[0] * DIRECT_GPS_AFFINE.y[1] - DIRECT_GPS_AFFINE.x[1] * DIRECT_GPS_AFFINE.y[0];
  const dLat = ((x - DIRECT_GPS_AFFINE.x[2]) * DIRECT_GPS_AFFINE.y[1] - (y - DIRECT_GPS_AFFINE.y[2]) * DIRECT_GPS_AFFINE.x[1]) / determinant;
  const dLng = (DIRECT_GPS_AFFINE.x[0] * (y - DIRECT_GPS_AFFINE.y[2]) - DIRECT_GPS_AFFINE.y[0] * (x - DIRECT_GPS_AFFINE.x[2])) / determinant;
  return {
    lat: DIRECT_GPS_AFFINE.centerLat + dLat / DIRECT_GPS_AFFINE.coordinateScale,
    lng: DIRECT_GPS_AFFINE.centerLng + dLng / DIRECT_GPS_AFFINE.coordinateScale,
  };
}

export function legacySvgToGps(x: number, y: number): { lat: number; lng: number } {
  const mapped = legacyCoordinatesToSvg(x, y);
  return svgToGps(mapped.x, mapped.y);
}

/**
 * Calculates exact distance in meters between two coordinates using Turf.js
 */
export function getTurfDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const from = turf.point([lng1, lat1]);
  const to = turf.point([lng2, lat2]);
  const distanceKm = turf.distance(from, to, { units: 'kilometers' });
  return Math.round(distanceKm * 1000);
}

/**
 * Finds the nearest spawn point from player GPS using Turf.js
 */
export function getNearestSpawn(
  playerLat: number,
  playerLng: number,
  spawns: SpawnPoint[]
): { spawn: SpawnPoint; distanceMeters: number } | null {
  if (!spawns || spawns.length === 0) return null;

  let nearestSpawn: SpawnPoint | null = null;
  let minDistance = Infinity;

  for (const spawn of spawns) {
    const dist = getTurfDistanceMeters(playerLat, playerLng, spawn.lat, spawn.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearestSpawn = spawn;
    }
  }

  if (!nearestSpawn) return null;

  return {
    spawn: nearestSpawn,
    distanceMeters: minDistance,
  };
}

/**
 * Determines if player is within claiming proximity of a spawn point
 */
export function isWithinClaimRadius(
  playerLat: number,
  playerLng: number,
  spawn: SpawnPoint
): boolean {
  const distance = getTurfDistanceMeters(playerLat, playerLng, spawn.lat, spawn.lng);
  return distance <= spawn.claimRadiusMeters;
}

/**
 * Determines whether a GPS coordinate is contained within the campus bounds
 */
export function isPointInsideCampus(lat: number, lng: number): boolean {
  const { northWest, southEast } = CAMPUS_GEO_BOUNDS;
  return (
    lat <= northWest.lat &&
    lat >= southEast.lat &&
    lng >= northWest.lng &&
    lng <= southEast.lng
  );
}

/**
 * Converts a distance in meters to approximate SVG units (pixels) on the campus canvas
 */
export function metersToSvgUnits(meters: number): number {
  const { northWest, southEast, svgWidth } = CAMPUS_GEO_BOUNDS;
  const campusWidthMeters = getTurfDistanceMeters(
    northWest.lat,
    northWest.lng,
    northWest.lat,
    southEast.lng
  );
  if (campusWidthMeters <= 0) return meters;
  return (meters / campusWidthMeters) * svgWidth;
}

