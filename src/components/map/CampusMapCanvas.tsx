import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { SpawnPoint, CampusZone } from '../../types';
import { getTurfDistanceMeters, gpsToSvg, legacyCoordinatesToSvg } from '../../lib/geo';
import { CampusSvgLayer } from './CampusSvgLayer';
import { CampusLandmark, getLandmarkById, getSvgHighlightTargetId } from '../../data/landmarks';

// ---------------------------------------------------------------------------
// Types & Processed Models
// ---------------------------------------------------------------------------

export interface CampusMapCanvasProps {
  spawns: SpawnPoint[];
  zones: CampusZone[];
  playerLat: number;
  playerLng: number;
  playerAccuracy?: number | null;
  playerHeading?: number | null;
  selectedSpawnId: string | null;
  onSelectSpawn: (spawn: SpawnPoint) => void;
  selectedLandmarkId?: string | null;
  onSelectLandmark?: (landmark: CampusLandmark | null) => void;
  showZoneOverlay?: boolean;
  onMapClick?: () => void;
  zoomAction?: { type: 'in' | 'out' | 'recenter' | 'focus'; target?: { x: number; y: number } } | null;
}

export interface ProcessedSpawnNode {
  id: string;
  spawn: SpawnPoint;
  svgX: number;
  svgY: number;
  points: number;
  distance: number;
  inRange: boolean;
  isClaimed: boolean;
  isSelected: boolean;
  claimRadiusMeters: number;
  pinBg: string;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  badgeText: string;
  labelText: string;
  labelColor: string;
  enabled: boolean;
}

// Distance Calculation Memoization Cache
const distanceCache = new Map<string, number>();

function getMemoizedDistance(
  pLat: number,
  pLng: number,
  sLat: number,
  sLng: number
): number {
  // Quantize coordinate resolution for high cache hit rate while maintaining meter accuracy
  const key = `${pLat.toFixed(5)},${pLng.toFixed(5)}_${sLat.toFixed(5)},${sLng.toFixed(5)}`;
  const cached = distanceCache.get(key);
  if (cached !== undefined) return cached;

  const dist = getTurfDistanceMeters(pLat, pLng, sLat, sLng);
  // Cap cache size to avoid memory leaks
  if (distanceCache.size > 2000) {
    distanceCache.clear();
  }
  distanceCache.set(key, dist);
  return dist;
}

interface CampusZonesLayerProps {
  zones: CampusZone[];
  showZoneOverlay: boolean;
}

const CampusZonesLayer = React.memo<CampusZonesLayerProps>(({ zones, showZoneOverlay }) => {
  if (!showZoneOverlay) return null;

  return (
    <g id="campus-zones" className="pointer-events-none" style={{ pointerEvents: 'none' }}>
      {zones.map((zone) => (
        <g key={zone.id} className="pointer-events-none" style={{ pointerEvents: 'none' }}>
          {/* Layer 2: Optional zone tint at 10–14% opacity with transparent fill and thin #F16321 dashed outline */}
          <path
            d={zone.svgPath}
            fill="#F16321"
            fillOpacity={0.12}
            stroke="#F16321"
            strokeWidth="1.5"
            strokeDasharray="6,4"
            className="pointer-events-none"
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={zone.centerSvgX}
            y={zone.centerSvgY - 120}
            textAnchor="middle"
            fill="#1A1310"
            fillOpacity="0.45"
            fontSize="18"
            fontWeight="bold"
            letterSpacing="3"
            className="font-display uppercase pointer-events-none select-none"
            style={{ pointerEvents: 'none' }}
          >
            {zone.name}
          </text>
        </g>
      ))}
    </g>
  );
});
CampusZonesLayer.displayName = 'CampusZonesLayer';

interface PlayerMarkerLayerProps {
  svgX: number;
  svgY: number;
  accuracy?: number | null;
  heading?: number | null;
}

/**
 * Isolated player location marker with animated radar halo
 * Memoized to avoid re-rendering on external canvas updates unless player coordinates change
 */
const PlayerMarkerLayer = React.memo<PlayerMarkerLayerProps>(
  ({ svgX, svgY, accuracy, heading }) => {
    const accuracyRadius = Math.max(38, Math.min(100, (accuracy ?? 20) * 1.4));
    return (
      <g
        id="player-location"
        transform={`translate(${svgX}, ${svgY})`}
        className="pointer-events-none"
        style={{ pointerEvents: 'none' }}
      >
        {/* Accuracy & Proximity Claim Radius Halo */}
        <circle
          r={accuracyRadius}
          fill="#F16321"
          fillOpacity="0.12"
          stroke="#F16321"
          strokeWidth="2"
          strokeDasharray="4,4"
          className="animate-pulse"
        />

        {/* Expanding Radar Wave */}
        <circle r="28" fill="none" stroke="#F16321" strokeWidth="2.5" opacity="0.6">
          <animate
            attributeName="r"
            from="14"
            to="55"
            dur="2.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            from="0.8"
            to="0"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </circle>

        {/* Core Player Dot */}
        <circle r="13" fill="#FFFFFF" stroke="#1A1310" strokeWidth="3" />
        <path
          d="M 0 -10 L 7 8 L 0 5 L -7 8 Z"
          fill="#F16321"
          stroke="#1A1310"
          strokeWidth="2"
          transform={`rotate(${heading ?? 0})`}
        />

        {/* Player Label Pill */}
        <g transform="translate(0, -26)">
          <rect
            x="-36"
            y="-14"
            width="72"
            height="18"
            rx="0"
            fill="#1A1310"
            stroke="#FAF4EB"
            strokeWidth="1.5"
          />
          <text
            x="0"
            y="-2"
            textAnchor="middle"
            fill="#FAF4EB"
            fontSize="10"
            fontWeight="bold"
            letterSpacing="1"
          >
            YOU
          </text>
        </g>
      </g>
    );
  },
  (prev, next) =>
    prev.svgX === next.svgX &&
    prev.svgY === next.svgY &&
    prev.accuracy === next.accuracy &&
    prev.heading === next.heading
);
PlayerMarkerLayer.displayName = 'PlayerMarkerLayer';

// ---------------------------------------------------------------------------
// Main Optimized D3.js Campus Map Component
// ---------------------------------------------------------------------------

export const CampusMapCanvas: React.FC<CampusMapCanvasProps> = React.memo(({
  spawns,
  zones,
  playerLat,
  playerLng,
  playerAccuracy,
  playerHeading,
  selectedSpawnId,
  onSelectSpawn,
  selectedLandmarkId,
  onSelectLandmark,
  showZoneOverlay = true,
  onMapClick,
  zoomAction,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const spawnsLayerRef = useRef<SVGGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const onSelectSpawnRef = useRef(onSelectSpawn);
  onSelectSpawnRef.current = onSelectSpawn;
  const onSelectLandmarkRef = useRef(onSelectLandmark);
  onSelectLandmarkRef.current = onSelectLandmark;

  // Handle building/landmark tap with smooth pan/zoom
  const handleSelectBuilding = useCallback((id: string) => {
    const landmark = getLandmarkById(id);
    if (landmark) {
      onSelectLandmarkRef.current?.(landmark);

      // Smooth pan & focus zoom to landmark centroid
      if (svgRef.current && zoomBehaviorRef.current && containerRef.current) {
        const width = containerRef.current.clientWidth || 375;
        const height = containerRef.current.clientHeight || 600;
        const scale = 1.1;
        const target = legacyCoordinatesToSvg(landmark.svgX, landmark.svgY);
        const targetX = width / 2 - target.x * scale;
        const targetY = height / 2 - target.y * scale;

        d3.select(svgRef.current)
          .transition()
          .duration(500)
          .ease(d3.easeCubicOut)
          .call(
            zoomBehaviorRef.current.transform,
            d3.zoomIdentity.translate(targetX, targetY).scale(scale)
          );
      }
    }
  }, []);

  // Convert player GPS to SVG coordinates
  const playerSvg = useMemo(() => gpsToSvg(playerLat, playerLng), [playerLat, playerLng]);

  // Selected landmark metadata for active highlight overlay
  const selectedLandmarkObj = useMemo(() => {
    return selectedLandmarkId ? getLandmarkById(selectedLandmarkId) : null;
  }, [selectedLandmarkId]);

  // -------------------------------------------------------------------------
  // 1. Data Processing & Memoization
  // Computes geometry and state for all spawn points with distance caching
  // -------------------------------------------------------------------------
  const processedSpawns = useMemo<ProcessedSpawnNode[]>(() => {
    return spawns.map((spawn) => {
      const isSelected = selectedSpawnId === spawn.id;
      const isClaimed = spawn.status === 'claimed';
      const distance = getMemoizedDistance(playerLat, playerLng, spawn.lat, spawn.lng);
      const inRange = distance <= spawn.claimRadiusMeters;

      let pinBg = '#F16321'; // Active orange
      let textColor = '#FAF4EB';
      let strokeColor = '#1A1310';
      let strokeWidth = isSelected ? 4 : 3;

      if (isClaimed) {
        pinBg = '#1A1310'; // Claimed near-black
        textColor = '#FAF4EB';
        strokeColor = '#FAF4EB';
      } else if (!inRange) {
        // Out of range: high-contrast hollow tint
        pinBg = '#FBF6EE';
        textColor = '#F16321';
        strokeColor = '#F16321';
      }

      const badgeText = isClaimed ? '✓' : `+${spawn.points}`;
      const labelText = isClaimed ? 'CLAIMED' : inRange ? 'IN RANGE' : `${distance}m`;
      const labelColor = isClaimed ? '#70625B' : inRange ? '#F16321' : '#1A1310';

      return {
        id: spawn.id,
        spawn,
        svgX: gpsToSvg(spawn.lat, spawn.lng).x,
        svgY: gpsToSvg(spawn.lat, spawn.lng).y,
        points: spawn.points,
        distance,
        inRange,
        isClaimed,
        isSelected,
        claimRadiusMeters: spawn.claimRadiusMeters,
        pinBg,
        textColor,
        strokeColor,
        strokeWidth,
        badgeText,
        labelText,
        labelColor,
        enabled: spawn.enabled !== false,
      };
    });
  }, [spawns, playerLat, playerLng, selectedSpawnId]);

  // -------------------------------------------------------------------------
  // 2. D3 Differential Updates for Spawn Points Layer
  // Uses D3 Data Join (enter, update, exit) with fine-grained DOM property diffing
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!spawnsLayerRef.current) return;

    const layer = d3.select(spawnsLayerRef.current);

    // D3 Data Join on ProcessedSpawnNode by ID
    const nodes = layer
      .selectAll<SVGGElement, ProcessedSpawnNode>('g.spawn-point-node')
      .data(processedSpawns, (d: ProcessedSpawnNode) => d.id);

    // ENTER: Create square kiosk-style claim markers for newly added spawns
    const enterNodes = nodes
      .enter()
      .append('g')
      .attr('class', 'spawn-point-node cursor-pointer select-none')
      .attr('filter', 'url(#shadow-pin)')
      .attr('transform', (d: ProcessedSpawnNode) => `translate(${d.svgX}, ${d.svgY})`)
      .style('opacity', 0)
      .on('click', (event: MouseEvent, d: ProcessedSpawnNode) => {
        event.stopPropagation();
        onSelectSpawnRef.current(d.spawn);
      })
      .on('touchstart', (event: TouchEvent) => {
        event.stopPropagation();
      });

    // Enter: Focus spinner circle (when selected)
    enterNodes
      .append('circle')
      .attr('class', 'focus-ring')
      .attr('r', 40)
      .attr('fill', 'none')
      .attr('stroke', '#F16321')
      .attr('stroke-width', 3.5)
      .attr('stroke-dasharray', '6,4')
      .style('animation', 'spin 8s linear infinite')
      .style('display', (d: ProcessedSpawnNode) => (d.isSelected ? 'block' : 'none'));

    // Enter: Range indicator circle (when selected)
    enterNodes
      .append('circle')
      .attr('class', 'range-halo')
      .attr('r', (d: ProcessedSpawnNode) => d.claimRadiusMeters * 1.5)
      .attr('fill', (d: ProcessedSpawnNode) => (d.inRange ? '#F16321' : '#70625B'))
      .attr('fill-opacity', (d: ProcessedSpawnNode) => (d.inRange ? 0.15 : 0.06))
      .attr('stroke', (d: ProcessedSpawnNode) => (d.inRange ? '#F16321' : '#70625B'))
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,4')
      .style('display', (d: ProcessedSpawnNode) => (d.isSelected ? 'block' : 'none'));

    // Enter: Ticket marker body and stem
    enterNodes
      .append('rect')
      .attr('class', 'pin-body')
      .attr('x', -29)
      .attr('y', -66)
      .attr('width', 58)
      .attr('height', 42)
      .attr('fill', (d: ProcessedSpawnNode) => d.pinBg)
      .attr('stroke', (d: ProcessedSpawnNode) => d.strokeColor)
      .attr('stroke-width', (d: ProcessedSpawnNode) => d.strokeWidth);

    enterNodes
      .append('path')
      .attr('class', 'pin-stem')
      .attr('d', 'M -8 -24 L 0 -14 L 8 -24 Z')
      .attr('fill', (d: ProcessedSpawnNode) => d.pinBg)
      .attr('stroke', (d: ProcessedSpawnNode) => d.strokeColor)
      .attr('stroke-width', (d: ProcessedSpawnNode) => d.strokeWidth);

    // Enter: Badge Text inside pin
    enterNodes
      .append('text')
      .attr('class', 'pin-badge font-display')
      .attr('x', 0)
      .attr('y', -41)
      .attr('text-anchor', 'middle')
      .attr('fill', (d: ProcessedSpawnNode) => d.textColor)
      .attr('font-size', 13)
      .attr('font-weight', 'bold')
      .attr('pointer-events', 'none')
      .text((d: ProcessedSpawnNode) => d.badgeText);

    // Enter: Floating Distance Tag Container
    const tagGroup = enterNodes
      .append('g')
      .attr('class', 'dist-tag')
      .attr('transform', 'translate(0, 16)');

    tagGroup
      .append('rect')
      .attr('x', -42)
      .attr('y', -12)
      .attr('width', 84)
      .attr('height', 18)
      .attr('rx', 6)
      .attr('fill', '#FFFFFF')
      .attr('stroke', '#1A1310')
      .attr('stroke-width', 2);

    tagGroup
      .append('text')
      .attr('class', 'tag-text font-mono')
      .attr('x', 0)
      .attr('y', 1)
      .attr('text-anchor', 'middle')
      .attr('fill', (d: ProcessedSpawnNode) => d.labelColor)
      .attr('font-size', 9)
      .attr('font-weight', 'bold')
      .attr('pointer-events', 'none')
      .text((d: ProcessedSpawnNode) => d.labelText);

    // Smooth enter transition
    enterNodes
      .transition()
      .duration(200)
      .ease(d3.easeQuadOut)
      .style('opacity', (d: ProcessedSpawnNode) => (d.enabled ? 1 : 0.45));

    // UPDATE: Differential in-place updates for existing nodes without DOM teardown
    nodes
      .merge(enterNodes)
      .each(function (d: ProcessedSpawnNode) {
        const node = d3.select(this);
        const prev = (this as any).__prevState;

        // Skip DOM property writes if state is unchanged (Fine-grained differential check)
        const isInitial = !prev;
        const positionChanged = isInitial || prev.svgX !== d.svgX || prev.svgY !== d.svgY;
        const statusChanged =
          isInitial ||
          prev.isClaimed !== d.isClaimed ||
          prev.inRange !== d.inRange ||
          prev.isSelected !== d.isSelected ||
          prev.points !== d.points ||
          prev.enabled !== d.enabled;
        const textChanged = isInitial || prev.labelText !== d.labelText || prev.badgeText !== d.badgeText;

        if (positionChanged) {
          node.attr('transform', `translate(${d.svgX}, ${d.svgY})`);
        }

        if (statusChanged) {
          node.style('opacity', d.enabled ? 1 : 0.45);

          // Update Pin Body
          node
            .select('path.pin-body')
            .attr('fill', d.pinBg)
            .attr('stroke', d.strokeColor)
            .attr('stroke-width', d.strokeWidth);

          // Update Pin Badge
          node.select('text.pin-badge').attr('fill', d.textColor);

          // Update Focus Ring
          node.select('circle.focus-ring').style('display', d.isSelected ? 'block' : 'none');

          // Update Range Halo
          node
            .select('circle.range-halo')
            .attr('r', d.claimRadiusMeters * 1.5)
            .attr('fill', d.inRange ? '#F16321' : '#70625B')
            .attr('fill-opacity', d.inRange ? 0.15 : 0.06)
            .attr('stroke', d.inRange ? '#F16321' : '#70625B')
            .style('display', d.isSelected ? 'block' : 'none');
        }

        if (textChanged) {
          node.select('text.pin-badge').text(d.badgeText);
          node
            .select('text.tag-text')
            .attr('fill', d.labelColor)
            .text(d.labelText);
        }

        // Cache state snapshot on DOM node
        (this as any).__prevState = {
          svgX: d.svgX,
          svgY: d.svgY,
          isClaimed: d.isClaimed,
          inRange: d.inRange,
          isSelected: d.isSelected,
          points: d.points,
          enabled: d.enabled,
          labelText: d.labelText,
          badgeText: d.badgeText,
        };
      });

    // EXIT: Clean removal of retired spawn points with fade out
    nodes
      .exit()
      .transition()
      .duration(150)
      .style('opacity', 0)
      .remove();
  }, [processedSpawns]);

  // -------------------------------------------------------------------------
  // 3. Initialize D3 Zoom and Pan with Performance Optimizations
  // Non-canceling requestAnimationFrame batching for smooth 60fps+ mobile interaction
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!svgRef.current || !gRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);

    let pendingTransform: d3.ZoomTransform | null = null;
    let rafId: number | null = null;

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4.0])
      .on('zoom', (event) => {
        pendingTransform = event.transform;
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            if (pendingTransform && gRef.current) {
              gRef.current.setAttribute('transform', pendingTransform.toString());
            }
            rafId = null;
          });
        }
      });

    svg.call(zoom);
    zoomBehaviorRef.current = zoom;

    // Initial center on player location
    const containerWidth = containerRef.current.clientWidth || 375;
    const containerHeight = containerRef.current.clientHeight || 600;

    const initialScale = 0.55;
    const initialX = containerWidth / 2 - playerSvg.x * initialScale;
    const initialY = containerHeight / 2 - playerSvg.y * initialScale;

    const initialTransform = d3.zoomIdentity.translate(initialX, initialY).scale(initialScale);
    svg.call(zoom.transform, initialTransform);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      svg.on('.zoom', null);
    };
  }, []);

  // -------------------------------------------------------------------------
  // 5. Handle external zoom actions (zoom in/out/recenter/focus)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!zoomAction || !svgRef.current || !zoomBehaviorRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    const zoom = zoomBehaviorRef.current;
    const width = containerRef.current.clientWidth || 375;
    const height = containerRef.current.clientHeight || 600;

    if (zoomAction.type === 'in') {
      svg.transition().duration(280).ease(d3.easeCubicOut).call(zoom.scaleBy, 1.35);
    } else if (zoomAction.type === 'out') {
      svg.transition().duration(280).ease(d3.easeCubicOut).call(zoom.scaleBy, 0.75);
    } else if (zoomAction.type === 'recenter') {
      const scale = 0.75;
      const targetX = width / 2 - playerSvg.x * scale;
      const targetY = height / 2 - playerSvg.y * scale;
      svg
        .transition()
        .duration(500)
        .ease(d3.easeCubicOut)
        .call(zoom.transform, d3.zoomIdentity.translate(targetX, targetY).scale(scale));
    } else if (zoomAction.type === 'focus' && zoomAction.target) {
      const scale = 1.1;
      const targetX = width / 2 - zoomAction.target.x * scale;
      const targetY = height / 2 - zoomAction.target.y * scale;
      svg
        .transition()
        .duration(500)
        .ease(d3.easeCubicOut)
        .call(zoom.transform, d3.zoomIdentity.translate(targetX, targetY).scale(scale));
    }
  }, [zoomAction, playerSvg.x, playerSvg.y]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#F8F3EA] overflow-hidden select-none cursor-grab active:cursor-grabbing touch-none"
      onClick={() => {
        onSelectLandmark?.(null);
        onMapClick?.();
      }}
    >
      <svg
        ref={svgRef}
        className="w-full h-full"
        viewBox="0 0 1991 3704"
        preserveAspectRatio="xMidYMid slice"
        style={{ shapeRendering: 'geometricPrecision', textRendering: 'optimizeLegibility' }}
      >
        <defs>
          {/* D3 Spawn Pin Shadow & Glow Filters */}
          <filter id="shadow-pin" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#1A1310" floodOpacity="0.25" />
          </filter>

          <filter id="glow-orange" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Canonical Campus Illustration Filters from MAP SVG/Group 2-2.svg */}
        </defs>

        {/* Master Scalable/Pannable Layer (Hardware Accelerated) */}
        <g ref={gRef} id="campus-world" style={{ willChange: 'transform', transformOrigin: '0 0' }}>
          {/* Layer 1: Canonical Full SVG Base Map (MAP SVG/Group 2-2.svg) */}
          <CampusSvgLayer
            selectedLandmarkId={selectedLandmarkId}
            onSelectLandmark={handleSelectBuilding}
          />

          {/* Tapped-landmark highlight stays above the single source SVG. */}
          <g id="tapped-landmark-highlight" className="pointer-events-none" style={{ pointerEvents: 'none' }}>
            {selectedLandmarkId && (
              <g className="pointer-events-none">
                {/* Active vector outline overlay */}
                <use
                  href={`#${getSvgHighlightTargetId(selectedLandmarkId)}`}
                  fill="none"
                  stroke="#F16321"
                  strokeWidth="3"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  filter="url(#landmark-glow-filter)"
                  className="pointer-events-none"
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            )}
          </g>

          {/* Layer 4: D3 Differential Rendered Spawn Points Layer */}
          <g ref={spawnsLayerRef} id="spawn-points" />

          {/* Layer 5: Player Location Marker with Live Pulsing Radar Ring */}
          <PlayerMarkerLayer
            svgX={playerSvg.x}
            svgY={playerSvg.y}
            accuracy={playerAccuracy}
            heading={playerHeading}
          />
        </g>
      </svg>
    </div>
  );
});

CampusMapCanvas.displayName = 'CampusMapCanvas';
