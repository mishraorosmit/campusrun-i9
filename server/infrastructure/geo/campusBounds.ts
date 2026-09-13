import { Coordinates, SvgCoordinates, BoundingBox } from '../../domain/types';

/**
 * Authoritative Campus Boundary Constants & Projections
 *
 * Sourced directly from:
 * - Canonical SVG: MAP SVG/Group 2-2.svg (width 1572, height 2927, viewBox '0 0 1572 2927')
 * - Authoritative PostGIS CRS: WGS 84 (SRID 4326)
 *
 * CRITICAL COORDINATE CONVENTIONS:
 * - Domain & HTTP API: { lat, lng } (Latitude first)
 * - PostGIS & WKT: (lng, lat) (Longitude / X axis first)
 * - SVG Canvas: (x, y) where (0,0) is top-left, x=[0, 1572], y=[0, 2927]
 */

export interface CampusControlPoint {
  id: string;
  code: string;
  name: string;
  zoneId: string;
  zoneName: string;
  svg: SvgCoordinates;
  gps: Coordinates;
  description: string;
}

export const AUTHORITATIVE_CAMPUS_BOUNDS = {
  srid: 4326,
  northWest: { lat: 37.4330, lng: -122.1765 } as Coordinates,
  northEast: { lat: 37.4330, lng: -122.1615 } as Coordinates,
  southEast: { lat: 37.4215, lng: -122.1615 } as Coordinates,
  southWest: { lat: 37.4215, lng: -122.1765 } as Coordinates,
  center: { lat: 37.42725, lng: -122.1690 } as Coordinates,
  latSpan: 0.0115, // 37.4330 - 37.4215
  lngSpan: 0.0150, // -122.1615 - (-122.1765)
  svgWidth: 1572,
  svgHeight: 2927,
  svgViewBox: '0 0 1572 2927',
  minX: 0,
  minY: 0,
  maxX: 1572,
  maxY: 2927,
};

/**
 * WGS 84 Closed Polygon WKT for PostGIS ST_GeogFromText / ST_GeomFromText
 * Notice: Longitude first, latitude second!
 */
export const CAMPUS_BOUNDARY_POLYGON_WKT = 
  'POLYGON((-122.1765 37.4330, -122.1615 37.4330, -122.1615 37.4215, -122.1765 37.4215, -122.1765 37.4330))';

/**
 * 8 Verified Landmark Calibration & Control Points
 * Connecting visual vector nodes in MAP SVG/Group 2-2.svg to physical GPS coordinates.
 */
export const CALIBRATION_CONTROL_POINTS: CampusControlPoint[] = [
  {
    id: 'ctrl-01',
    code: 'CTRL-NW-GATE',
    name: 'North-West Campus Perimeter Gate',
    zoneId: 'zone-north-hostels',
    zoneName: 'North Hostel Enclave',
    svg: { x: 0, y: 0 },
    gps: { lat: 37.4330, lng: -122.1765 },
    description: 'Extreme North-West corner of the institutional campus boundary.',
  },
  {
    id: 'ctrl-02',
    code: 'CTRL-BH7-FLAG',
    name: 'BH-7 Courtyard Flagpole',
    zoneId: 'zone-north-hostels',
    zoneName: 'North Hostel Enclave',
    svg: { x: 385, y: 137 },
    gps: { lat: 37.432462, lng: -122.172826 },
    description: 'Under the stone monolith at the entrance of Boys Hostel 7.',
  },
  {
    id: 'ctrl-03',
    code: 'CTRL-CDS-ATRIUM',
    name: 'Center of Data Science Atrium',
    zoneId: 'zone-academic-core',
    zoneName: 'Academic Quad & Tech Hub',
    svg: { x: 865, y: 611 },
    gps: { lat: 37.430599, lng: -122.168246 },
    description: 'Glass concourse under the high-performance computing wing.',
  },
  {
    id: 'ctrl-04',
    code: 'CTRL-DBLK-SUNDIAL',
    name: 'D-Block Plaza Sundial',
    zoneId: 'zone-central-blocks',
    zoneName: 'Central Department Complex',
    svg: { x: 330, y: 1260 },
    gps: { lat: 37.428050, lng: -122.173351 },
    description: 'Centennial brass sundial in the center of the D-Block garden.',
  },
  {
    id: 'ctrl-05',
    code: 'CTRL-CRK-PAVILION',
    name: 'Cricket Pavilion Scoreboard',
    zoneId: 'zone-sports-arena',
    zoneName: 'Athletics & Sports Complex',
    svg: { x: 390, y: 1615 },
    gps: { lat: 37.426655, lng: -122.172779 },
    description: 'Near the boundary line under the west tree canopy of Cricket Court 1.',
  },
  {
    id: 'ctrl-06',
    code: 'CTRL-LH3-QUAD',
    name: 'Lecture Hall 3 South Quad',
    zoneId: 'zone-south-hostels',
    zoneName: 'South Residential Valley',
    svg: { x: 845, y: 2145 },
    gps: { lat: 37.424572, lng: -122.168437 },
    description: 'Breezeway entrance connecting LH-3 to the south residential link.',
  },
  {
    id: 'ctrl-07',
    code: 'CTRL-FT2-BLEACHER',
    name: 'South Football Ground Bleachers',
    zoneId: 'zone-south-hostels',
    zoneName: 'South Residential Valley',
    svg: { x: 1345, y: 2825 },
    gps: { lat: 37.421901, lng: -122.163666 },
    description: 'Southern sports arena floodlight mast beside Court 2.',
  },
  {
    id: 'ctrl-08',
    code: 'CTRL-SE-BOUND',
    name: 'South-East Campus Perimeter Boundary',
    zoneId: 'zone-south-hostels',
    zoneName: 'South Residential Valley',
    svg: { x: 1572, y: 2927 },
    gps: { lat: 37.4215, lng: -122.1615 },
    description: 'Extreme South-East corner of the institutional campus boundary.',
  },
];
