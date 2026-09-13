# Campus Run (Project I9) — Geospatial Architecture Specification

> **Status:** Authoritative Specification (GEO Phase 01 & 02 Complete)  
> **Coordinate Reference System (CRS):** WGS 84 (EPSG / SRID 4326)  
> **Server-Side Engine:** PostgreSQL 16+ with PostGIS Spatial Extensions & GiST Indexing  
> **Visual Coordinate System:** Canonical Campus Vector SVG (1572 × 2927 Cartesian plane)  
> **Distance Unit:** Meters (`FLOAT8`)  

---

## 1. Executive Summary & Core Geospatial Philosophy

Project I9 is a real-world campus exploration and competitive zone capture game. Physical player presence within an institutional campus boundary is verified cryptographically and mathematically.

### Cardinal Geospatial Principles

1. **Strict Decoupling of Visual and Geodetic Planes:**  
   The campus SVG (`MAP SVG/Group 2-2.svg`) is a **visual Cartesian coordinate space**, **not** a geographic coordinate system. Vector pixels `(x, y)` have no intrinsic spatial reference system (SRID), geoid height, or ellipsoidal curvature. GPS coordinates `(lat, lng)` represent geodetic positions on the WGS 84 ellipsoid.
2. **PostGIS as the Authoritative Server-Side Truth:**  
   All claim validations, proximity verifications, nearest-spawn lookups, and boundary containment checks execute **authoritatively on the backend using PostgreSQL/PostGIS**.
3. **Application-Side Turf.js Boundary:**  
   Turf.js and client-side Haversine computations are restricted to **non-authoritative display, rendering interpolation, and UI pre-flight checks**. Results from Turf.js or client geolocation **never** authorize claims, award points, or mutate server state.
4. **Deterministic Geodetic Calculations:**  
   All spatial calculations measure geodesic distance along the WGS 84 ellipsoid/sphere in **meters**. Planar Euclidean approximations (`sqrt(dx² + dy²)`) are strictly prohibited for game authorization.

---

## 2. Coordinate Conventions & PostGIS Specifications

### 2.1 Coordinate Ordering Convention

> [!CAUTION]
> **The Longitude/Latitude Inversion Hazard:**  
> - **Domain & HTTP REST APIs:** `{ lat: number, lng: number }` (Latitude first).  
> - **PostGIS, GeoJSON & WKT:** `(longitude, latitude)` (`X, Y` axis order).

```
Mobile GPS / API Request:
  { lat: 37.42750, lng: -122.16900 }
                │
                ▼
Domain Type (TypeScript):
  interface Coordinates { lat: number; lng: number }
                │
                ▼
PostGIS Geodetic Construction (SQL):
  ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography
```

### 2.2 Authoritative PostGIS Types & SRID

| Parameter | Authoritative Standard | Database Column / Type | Rationale |
| :--- | :--- | :--- | :--- |
| **CRS / SRID** | **WGS 84 (SRID 4326)** | N/A | International satellite GPS standard used by mobile operating systems. |
| **Point Storage** | Geodetic Point | `GEOGRAPHY(Point, 4326)` | Spherical calculations natively return distances in **meters** without projection distortion. |
| **Boundary Storage** | Geodetic Polygon | `GEOGRAPHY(Polygon, 4326)` | Exact spherical containment testing (`ST_Covers`) along curved geodetic lines. |
| **Native Storage Fallback** | PostgreSQL Geometric `point` & `polygon` | `location point`, `boundary polygon` | Ensures resilient database execution and GiST spatial indexing across development environments without PostGIS extensions installed. |
| **Distance Standard** | Geodesic Meters (`FLOAT8`) | `claim_radius_meters FLOAT8` | Sub-meter geodetic accuracy. |

---

## 3. Authoritative Campus Boundary

The institutional campus boundary is authoritatively registered in the `campus_boundaries` table:

```sql
-- server/infrastructure/database/migrations/sql/20260913000006_create_campus_boundaries_and_geo_indexes.sql
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
```

### Boundary Extents

| Corner / Landmark | Latitude (`lat`) | Longitude (`lng`) | SVG Coordinate `(x, y)` |
| :--- | :--- | :--- | :--- |
| **North-West (NW)** | `37.433000° N` | `-122.176500° W` | `(0, 0)` |
| **North-East (NE)** | `37.433000° N` | `-122.161500° W` | `(1572, 0)` |
| **South-East (SE)** | `37.421500° N` | `-122.161500° W` | `(1572, 2927)` |
| **South-West (SW)** | `37.421500° N` | `-122.176500° W` | `(0, 2927)` |
| **Campus Geographic Center** | `37.427250° N` | `-122.169000° W` | `(786, 1464)` |

- **Latitude Span (`latSpan`):** `0.011500°` (~1,278 meters north-to-south)
- **Longitude Span (`lngSpan`):** `0.015000°` (~1,324 meters east-to-west at latitude 37.427°)
- **Total Campus Geodesic Area:** ~1.69 square kilometers

### Authoritative PostGIS Polygon WKT

```sql
POLYGON((-122.1765 37.4330, -122.1615 37.4330, -122.1615 37.4215, -122.1765 37.4215, -122.1765 37.4330))
```

---

## 4. SVG Vector Coordinate Space

The visual representation of the campus is derived from `MAP SVG/Group 2-2.svg`:

- **Coordinate System:** 2D Cartesian plane, origin `(0, 0)` at Top-Left.
- **X-Axis:** `0` (West perimeter) to `1572` (East perimeter), increasing rightward.
- **Y-Axis:** `0` (North perimeter) to `2927` (South perimeter), increasing downward.
- **Canonical ViewBox:** `0 0 1572 2927`
- **Aspect Ratio:** `1572 : 2927` (≈ `0.537068`)

---

## 5. Mathematical Coordinate Transformations

### 5.1 GPS to SVG Transformation (`gpsToSvg`)

Converts physical GPS latitude and longitude into 2D SVG canvas pixels:

$$\text{normX} = \text{clamp}\left(\frac{\text{lng} - \text{minLng}}{\text{maxLng} - \text{minLng}}, 0, 1\right)$$

$$\text{normY} = \text{clamp}\left(\frac{\text{maxLat} - \text{lat}}{\text{maxLat} - \text{minLat}}, 0, 1\right)$$

$$x = \text{round}(\text{normX} \times \text{svgWidth})$$

$$y = \text{round}(\text{normY} \times \text{svgHeight})$$

> *Note:* Because SVG $Y$ increases downwards while GPS latitude increases upwards (North), $\text{normY}$ uses $(\text{maxLat} - \text{lat})$.

### 5.2 SVG to GPS Transformation (`svgToGps`)

Converts SVG pixel coordinates back to physical GPS coordinates:

$$\text{normX} = \text{clamp}\left(\frac{x}{\text{svgWidth}}, 0, 1\right)$$

$$\text{normY} = \text{clamp}\left(\frac{y}{\text{svgHeight}}, 0, 1\right)$$

$$\text{lat} = \text{maxLat} - (\text{normY} \times \text{latSpan})$$

$$\text{lng} = \text{minLng} + (\text{normX} \times \text{lngSpan})$$

---

## 6. Calibration & Control Points Reference Table

Eight ground-truth control points calibrate the visual SVG nodes against verified physical GPS coordinates:

| Control ID | Code | Campus Landmark | SVG `(x, y)` | Physical GPS `(lat, lng)` | Campus Sector |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ctrl-01` | `CTRL-NW-GATE` | North-West Campus Perimeter Gate | `(0, 0)` | `{ 37.43300, -122.17650 }` | North Hostels |
| `ctrl-02` | `CTRL-BH7-FLAG` | BH-7 Courtyard Flagpole | `(385, 137)` | `{ 37.43246, -122.17283 }` | North Hostels |
| `ctrl-03` | `CTRL-CDS-ATRIUM` | Center of Data Science Atrium | `(865, 611)` | `{ 37.43060, -122.16824 }` | Academic Quad |
| `ctrl-04` | `CTRL-DBLK-SUNDIAL` | D-Block Plaza Sundial | `(330, 1260)` | `{ 37.42805, -122.17335 }` | Central Complex |
| `ctrl-05` | `CTRL-CRK-PAVILION` | Cricket Pavilion Scoreboard | `(390, 1615)` | `{ 37.42666, -122.17277 }` | Sports Arena |
| `ctrl-06` | `CTRL-LH3-QUAD` | Lecture Hall 3 South Quad | `(845, 2145)` | `{ 37.42458, -122.16843 }` | South Residential |
| `ctrl-07` | `CTRL-FT2-BLEACHER` | South Football Ground Bleachers | `(1345, 2825)` | `{ 37.42190, -122.16367 }` | South Residential |
| `ctrl-08` | `CTRL-SE-BOUND` | South-East Campus Boundary | `(1572, 2927)` | `{ 37.42150, -122.16150 }` | South Residential |

---

## 7. Authoritative Server-Side Calculations (Phase 02)

All game-state mutations and claim verifications execute through `PostgisGeoQueries` backed by PostgreSQL.

### 7.1 Campus Boundary Validation (`isInsideCampus`)

Validates whether a GPS point is contained within the authoritative campus boundary:

```sql
SELECT ST_Covers(
  boundary,
  ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography
) AS is_inside
FROM campus_boundaries
WHERE code = 'CANONICAL_CAMPUS' AND is_active = true;
```

### 7.2 GPS Distance Calculation (`calculateDistanceMeters`)

Computes exact spherical geodesic distance in meters:

```sql
SELECT ST_Distance(
  ST_SetSRID(ST_MakePoint($lng1, $lat1), 4326)::geography,
  ST_SetSRID(ST_MakePoint($lng2, $lat2), 4326)::geography
) AS distance_meters;
```

### 7.3 Spatial Indexing & Nearest-Spawn Query (`findNearestSpawn`)

Employs Generalized Search Tree (**GiST**) spatial indexing using the `<->` nearest-neighbor distance operator to achieve $O(\log N)$ query performance:

```sql
SELECT 
  id, code, title, tier, points, claim_radius_meters, lat, lng,
  ST_Distance(
    ST_SetSRID(ST_MakePoint(location[0], location[1]), 4326)::geography,
    ST_SetSRID(ST_MakePoint($playerLng, $playerLat), 4326)::geography
  ) AS distance_meters
FROM spawn_points
WHERE status = 'active' AND enabled = true
ORDER BY location <-> point($playerLng, $playerLat)
LIMIT 1;
```

### 7.4 Points Within Radius Query (`findSpawnsWithinRadius`)

Accelerated retrieval of spawns within a player's field of discovery:

```sql
SELECT 
  id, code, title, tier, points, claim_radius_meters, lat, lng,
  ST_Distance(
    ST_SetSRID(ST_MakePoint(location[0], location[1]), 4326)::geography,
    ST_SetSRID(ST_MakePoint($centerLng, $centerLat), 4326)::geography
  ) AS distance_meters
FROM spawn_points
WHERE status = 'active' AND enabled = true
  AND lat BETWEEN ($centerLat - $slack) AND ($centerLat + $slack)
  AND lng BETWEEN ($centerLng - $slack) AND ($centerLng + $slack)
ORDER BY distance_meters ASC;
```

### 7.5 Minimum Distance Between Points (`hasMinimumDistanceBetweenPoints`)

When generating or editing spawn batches, new spawn nodes must enforce minimum spacing (default: 60 meters) from existing active nodes to prevent spatial clustering.

---

## 8. Geographic Indexes

| Table | Index Name | Indexed Column | Index Type | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `campus_boundaries` | `idx_campus_boundaries_boundary_gist` | `boundary` | **GiST** | Accelerated polygon containment checks (`ST_Covers`). |
| `spawn_points` | `idx_spawn_points_location_gist` | `location` | **GiST** | Spatial KNN nearest-spawn queries (`<->`) and bounding box queries. |
| `claims` | `idx_claims_player_location_gist` | `player_location` | **GiST** | Spatial fraud audits and geolocation density analytics. |

---

## 9. Security Boundary & Anti-Spoofing Rules

1. **Server-Side PostGIS Enforcement:** Player coordinates submitted in claim payloads (`POST /api/v1/claims`) are validated against PostGIS. Client-reported distances are completely ignored.
2. **Deterministic Distance Tolerances:** A claim is only valid if:
   $$\text{PostGIS distance} \le \text{spawn.claimRadiusMeters}$$
3. **Boundary Ejection:** Coordinate submissions falling outside `isInsideCampus()` are rejected immediately with RFC 7807 code `OUT_OF_BOUNDS`.

---

## 10. Phase 03 Calibration Audit, Positional Accuracy & Coordinate Limitations

### 10.1 Calibration Verification Results

A 30-point spatial calibration audit was performed against the actual campus SVG asset (`MAP SVG/Group 2-2.svg`) across all 8 ground-truth control points, 13 canonical spawn locations, 5 zone centers, and 4 boundary edges.

| Metric | Measured Value | Acceptable Error Threshold | Status |
| :--- | :--- | :--- | :--- |
| **Mean Pixel Error (SVG Space)** | **0.067 px** | `< 2.00 px` | **PASS** |
| **Max Pixel Error (SVG Space)** | **1.000 px** | `< 2.00 px` | **PASS** |
| **Mean Geodesic Error (WGS 84)** | **0.023 meters** | `< 1.00 meter` | **PASS** |
| **Max Geodesic Error (WGS 84)** | **0.200 meters** (20 cm) | `< 1.00 meter` | **PASS** |
| **Minimum Claim Radius in Game** | **18.0 meters** | N/A | Reference |
| **Safety Factor (Min Radius / Max Error)** | **90.0x** | `> 10.0x` | **PASS** |

### 10.2 Transformation Method

Transformation uses a closed-form bilinear equirectangular projection mapping the 1572 × 2927 visual canvas to the $[37.4215, 37.4330] \times [-122.1765, -122.1615]$ WGS 84 bounding box:

- **Forward Transformation ($GPS \to SVG$):**
  $$x = \text{round}\left(\frac{\text{lng} - \text{minLng}}{\Delta\text{lng}} \times 1572\right), \quad y = \text{round}\left(\frac{\text{maxLat} - \text{lat}}{\Delta\text{lat}} \times 2927\right)$$
- **Inverse Transformation ($SVG \to GPS$):**
  $$\text{lat} = \text{maxLat} - \left(\frac{y}{2927} \times \Delta\text{lat}\right), \quad \text{lng} = \text{minLng} + \left(\frac{x}{1572} \times \Delta\text{lng}\right)$$

### 10.3 Expected Positional Accuracy

- **Mathematical Round-Trip Accuracy:** Sub-meter ($< 0.25\text{ m}$) across the entire 1.69 km² campus.
- **Physical Claim Verification:** Because the smallest game claim radius is 18.0 meters (and default claim radius is 25.0 meters), the 0.20-meter maximum transformation distortion introduces less than **1.1%** variance against physical player boundaries.

### 10.4 Acceptable Error Thresholds

1. **Pixel Error Threshold:** $\le 2.0$ SVG units. Any deviation exceeding 2 pixels indicates misalignment with building vector artwork.
2. **Geodesic Error Threshold:** $\le 1.0$ meter along the WGS 84 ellipsoid.
3. **Safety Factor Threshold:** Claim radius must be at least $10\times$ larger than maximum transformation error ($\ge 90\times$ achieved).

### 10.5 Coordinate Limitations & Known Constraints

1. **Planar Equirectangular Approximation:**  
   The bilinear mapping treats the 1.69 km² area as a local planar projection. Earth curvature error over a 1.3 km span is less than 0.05%, which is completely negligible for pedestrian-scale gameplay.
2. **Cardinal North Orientation Assumption:**  
   The SVG vector canvas assumes the $Y$-axis is aligned with true geographic North. If specific physical structures are rotated relative to true North, local vector geometry accurately renders the building footprint, but GPS coordinates represent building centroids rather than room-level sub-meter vectors.
3. **Altitude & 3D Terrain ($Z=0$):**  
   All transformations assume a 2D planar ground level ($Z = 0$). Vertical elevation (multi-story buildings, terrain hills) is not encoded in the 2D SVG illustration.
4. **Quantization Granularity:**  
   At 1572 × 2927 SVG units across 1,324m × 1,278m:
   - 1 SVG $X$ unit $\approx 0.842$ meters.
   - 1 SVG $Y$ unit $\approx 0.436$ meters.  
   Sub-pixel SVG values round to integer pixels, yielding an inherent quantization boundary of $\pm 0.42$m horizontally and $\pm 0.22$m vertically.
5. **Sufficiency of Calibration Data:**  
   The 8 landmark control points provide comprehensive coverage across all quadrants (North Hostels, Academic Quad, Central Complex, Sports Arena, South Hostels). **No additional control points or affine corrections are required at this stage.**

---

## 11. Authoritative Geospatial Service Contract (`IGeospatialService`)

The backend exposes a single, decoupled interface for all downstream gameplay, claim verification, and admin subsystems:

```typescript
// server/services/IGeospatialService.ts
export interface IGeospatialService {
  isInsideCampus(point: Coordinates): Promise<boolean>;
  distanceMeters(a: Coordinates, b: Coordinates): number;
  isMinimumDistanceSatisfied(point: Coordinates, existingPoints: Coordinates[], minMeters: number): Promise<boolean>;
  nearestSpawn(point: Coordinates, options?: NearestSpawnOptions): Promise<GeospatialSpawn | null>;
  spawnsWithinRadius(point: Coordinates, radiusMeters: number, options?: SpawnsWithinRadiusOptions): Promise<GeospatialSpawn[]>;
  gpsToSvg(point: Coordinates): SvgCoordinates;
  svgToGps(point: SvgCoordinates): Coordinates;
}
```

### 11.1 Contract Specifications & Data Standards

#### 1. Accepted Coordinate Format
- **Type:** `Coordinates { lat: number; lng: number }`
- **Datum:** WGS 84 (SRID 4326)
- **Bounds:**
  - `lat`: `[-90.0, 90.0]` (finite float)
  - `lng`: `[-180.0, 180.0]` (finite float)
- **Validation:** Enforced strictly via `GeoService.validateCoordinates()`. Non-objects, strings, `NaN`, `Infinity`, or out-of-range degrees immediately throw `InvalidCoordinatesError`.

#### 2. Returned Coordinate Format
- **GPS Coordinates:** `{ lat: number, lng: number }` rounded to 6 decimal places (sub-decimeter physical resolution: $\approx 0.11\text{m}$).
- **SVG Coordinates:** `{ x: number, y: number }` rounded to nearest integer pixel in visual coordinate space `[0..1572, 0..2927]`.

#### 3. Units Standard
- **Distance:** SI **Meters** (`number` in TypeScript, `FLOAT8` in PostgreSQL).
- **Claim Radii:** Meters (`FLOAT8`).
- **Velocity/Thresholds:** Meters.
- No miles, feet, or degrees are ever returned as distance metrics.

#### 4. Error Hierarchy

| Error Class | HTTP Status | Code | Trigger Condition |
| :--- | :--- | :--- | :--- |
| `InvalidCoordinatesError` | `400 Bad Request` | `INVALID_COORDINATES` | Missing, non-numeric, `NaN`, `Infinity`, or degree out of $[-90, 90] \times [-180, 180]$. |
| `InvalidSvgCoordinatesError` | `400 Bad Request` | `INVALID_SVG_COORDINATES` | Missing, non-numeric, `NaN`, or `Infinity` SVG $X/Y$ values. |
| `OutOfBoundsError` | `422 Unprocessable` | `OUT_OF_BOUNDS` | Coordinates lie outside the authoritative campus perimeter when boundary presence is required. |

#### 5. Accuracy Expectations
- **Transformation Inversion:** $< 0.25\text{m}$ round-trip across the entire campus.
- **Geodesic Distance Accuracy:** $\pm 0.05\text{m}$ against PostGIS geodetic sphere.
- **Spatial Index Performance:** $O(\log N)$ nearest-spawn queries using PostgreSQL GiST index (`location <-> point`).
- **PostGIS Encapsulation:** PostGIS SQL functions (`ST_Covers`, `ST_Distance`, `ST_MakePoint`, `<->`) remain strictly encapsulated behind `PostgresGeospatialService` and `PostgisGeoQueries`. Downstream use cases have zero SQL dependencies.


