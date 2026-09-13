import React, { useState, useEffect, useCallback } from 'react';
import { SpawnPoint, CampusZone, PlayerProfile } from '../../types';
import { CampusMapCanvas } from '../../components/map/CampusMapCanvas';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { PointDetailSheet } from '../../components/gameplay/PointDetailSheet';
import { LandmarkDetailSheet } from '../../components/gameplay/LandmarkDetailSheet';
import { ClaimConfirmationModal } from '../../components/gameplay/ClaimConfirmationModal';
import { ClaimResult } from '../../services/types';
import { getTurfDistanceMeters, getNearestSpawn, gpsToSvg } from '../../lib/geo';
import { CampusLandmark, getNearbySpawnsForLandmark, getNearestActiveSpawn } from '../../data/landmarks';
import { MAP_PALETTE } from '../../styles/tokens';
import {
  Locate,
  Layers,
  Plus,
  Minus,
  Footprints,
  AlertTriangle,
  WifiOff,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';

export interface MapPageProps {
  spawns: SpawnPoint[];
  zones: CampusZone[];
  player: PlayerProfile;
  playerLat: number;
  playerLng: number;
  playerAccuracy?: number | null;
  playerHeading?: number | null;
  onClaimSpawn: (spawnId: string) => Promise<ClaimResult | { success: boolean; message: string }>;
  isSimulatingGps?: boolean;
  onToggleSimulatedGps?: () => void;
  onUpdateSimulatedPosition?: (lat: number, lng: number) => void;
  locationError?: string | null;
}

export const MapPage: React.FC<MapPageProps> = ({
  spawns,
  zones,
  player,
  playerLat,
  playerLng,
  playerAccuracy,
  playerHeading,
  onClaimSpawn,
  isSimulatingGps,
  onToggleSimulatedGps,
  onUpdateSimulatedPosition,
  locationError,
}) => {
  const [selectedSpawn, setSelectedSpawn] = useState<SpawnPoint | null>(null);
  const [selectedLandmark, setSelectedLandmark] = useState<CampusLandmark | null>(null);
  const [showZoneOverlay, setShowZoneOverlay] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [zoomAction, setZoomAction] = useState<{
    type: 'in' | 'out' | 'recenter' | 'focus';
    target?: { x: number; y: number };
  } | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showLocationDeniedModal, setShowLocationDeniedModal] = useState(!!locationError);

  // Screen 05: Claim Confirmation Modal State
  const [claimModalData, setClaimModalData] = useState<{
    isOpen: boolean;
    spawn: SpawnPoint;
    pointsEarned: number;
    oldRank: number;
    newRank: number;
    updatedWeeklyPoints: number;
    updatedTotalPoints: number;
  } | null>(null);

  // Monitor online/offline state (Screen 03c)
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Update location error state (Screen 03a)
  useEffect(() => {
    if (locationError && !isSimulatingGps) {
      setShowLocationDeniedModal(true);
    } else {
      setShowLocationDeniedModal(false);
    }
  }, [locationError, isSimulatingGps]);

  // Active spawns count
  const activeSpawns = spawns.filter((s) => s.status === 'active');
  const allSpawnsClaimed = activeSpawns.length === 0;

  // Nearest spawn calculation using Turf.js
  const nearestResult = getNearestSpawn(playerLat, playerLng, activeSpawns);

  // Handle pin click
  const handleSelectSpawn = useCallback((spawn: SpawnPoint) => {
    setSelectedLandmark(null);
    setSelectedSpawn(spawn);
    const svgCoords = gpsToSvg(spawn.lat, spawn.lng);
    setZoomAction({ type: 'focus', target: svgCoords });
  }, []);

  // Handle landmark click
  const handleSelectLandmark = useCallback((landmark: CampusLandmark | null) => {
    setSelectedLandmark(landmark);
    if (landmark) setSelectedSpawn(null);
  }, []);

  // Handle background canvas click
  const handleMapClick = useCallback(() => {
    setSelectedSpawn(null);
    setSelectedLandmark(null);
  }, []);

  // Claim handler
  const handleClaim = async (spawnId: string) => {
    const res = (await onClaimSpawn(spawnId)) as ClaimResult;
    if (res.success && res.spawn) {
      // Open Screen 05: Claim Confirmation Modal
      setClaimModalData({
        isOpen: true,
        spawn: res.spawn,
        pointsEarned: res.pointsAwarded,
        oldRank: res.oldRank || player.rank,
        newRank: res.newRank || player.rank,
        updatedWeeklyPoints: res.updatedWeeklyPoints || player.seasonPoints + res.pointsAwarded,
        updatedTotalPoints: res.updatedTotalPoints || player.totalPoints + res.pointsAwarded,
      });
      setSelectedSpawn(null);
      setSelectedLandmark(null);
    }
  };

  // Simulated walk towards target point (Dev/Testing Feature)
  const handleWalkCloser = (targetSpawn?: SpawnPoint) => {
    const target = targetSpawn || selectedSpawn || nearestResult?.spawn;
    if (!target || !onUpdateSimulatedPosition) return;

    // Move player right onto the spawn point (0 meters away)
    onUpdateSimulatedPosition(target.lat, target.lng);
    setZoomAction({ type: 'recenter' });
  };

  const selectedZone = selectedSpawn
    ? zones.find((z) => z.id === selectedSpawn.zoneId) || null
    : null;

  return (
    <div className="relative w-full h-full flex-1 bg-[#F4EFE6] overflow-hidden flex flex-col">
      {/* Screen 03c: Offline Banner */}
      {isOffline && (
        <div className="bg-[#5B7C99] text-[#FAF4EB] px-4 py-2 flex items-center justify-between text-xs font-medium z-30 shadow-xs">
          <div className="flex items-center gap-2">
            <WifiOff className="w-3.5 h-3.5 text-[#FBF6EE]" />
            <span>Offline Mode — Showing cached campus map</span>
          </div>
          <span className="text-[10px] bg-[#FAF4EB]/20 px-2 py-0.5 rounded font-mono">
            LOCAL
          </span>
        </div>
      )}

      {/* Screen 03b: No Active Spawns Banner */}
      {allSpawnsClaimed && (
        <div className="bg-[#1A1310] text-[#FAF4EB] px-4 py-2 flex items-center justify-between text-xs font-medium z-30 shadow-xs border-b border-[#EADBC8]/20">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#F16321]" />
            <span>All rotation spawns claimed! Next drop incoming.</span>
          </div>
          <span className="text-[10px] bg-[#F16321] text-[#FAF4EB] px-2 py-0.5 rounded-full font-bold">
            RESETTING
          </span>
        </div>
      )}

      {/* Top Map Action Header Overlay */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        {/* Active Spawns Pill */}
        <div className="pointer-events-auto bg-white border-2 border-[#1A1310] px-3 py-1.5 shadow-[3px_3px_0_#1A1310]">
          <span className="text-xs font-bold font-mono text-[#1A1310] uppercase">
            {activeSpawns.length} active drops
          </span>
        </div>

        {/* Right Controls */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* Map Layers & Legend Button */}
          <button
            onClick={() => setShowLegend(!showLegend)}
            title="Map Layers & Landmark Legend"
              className={`p-2 bg-white border-2 border-[#1A1310] shadow-[3px_3px_0_#1A1310] transition-colors flex items-center gap-1.5 ${
              showLegend
                ? 'bg-[#F16321] text-white'
              : 'text-[#1A1310] hover:text-[#F16321]'
            }`}
          >
            <Layers className="w-4 h-4" />
          </button>

          {/* GPS Simulation Toggle */}
          {onToggleSimulatedGps && (
            <button
              onClick={onToggleSimulatedGps}
              title="Toggle GPS Mode"
              className={`px-2.5 py-1.5 rounded-xl border shadow-xs text-xs font-bold flex items-center gap-1.5 transition-colors ${
                isSimulatingGps
                  ? 'bg-[#F16321] text-[#FAF4EB] border-[#D44E11]'
                  : 'bg-[#FAF4EB] text-[#70625B] border-[#EADBC8]'
              }`}
            >
              <Locate className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-wider">
                {isSimulatingGps ? 'START TRACKING' : 'TRACKING LIVE'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Primary D3.js SVG Campus Canvas */}
      <div className="relative flex-1 w-full h-full">
        <CampusMapCanvas
          spawns={spawns}
          zones={zones}
          playerLat={playerLat}
          playerLng={playerLng}
          playerAccuracy={playerAccuracy}
          playerHeading={playerHeading}
          selectedSpawnId={selectedSpawn?.id || null}
          onSelectSpawn={handleSelectSpawn}
          selectedLandmarkId={selectedLandmark?.id || null}
          onSelectLandmark={handleSelectLandmark}
          showZoneOverlay={showZoneOverlay}
          onMapClick={handleMapClick}
          zoomAction={zoomAction}
        />

        {/* Floating Map Zoom & Recenter Controls (Right Edge) */}
        <div className="absolute right-3 bottom-4 z-20 flex flex-col gap-2 pointer-events-auto">
          {/* Recenter / Locate Button */}
          <button
            onClick={() => setZoomAction({ type: 'recenter' })}
            title="Recenter on my location"
            className="w-10 h-10 sm:w-11 sm:h-11 bg-white text-[#1A1310] border-2 border-[#1A1310] shadow-[3px_3px_0_#1A1310] flex items-center justify-center hover:bg-[#FDE8D7] active:translate-x-0.5 active:translate-y-0.5 transition-transform"
          >
            <Locate className="w-5 h-5 text-[#F16321]" />
          </button>

          {/* Walk to Nearest/Selected Button (Proximity testing) */}
          {onUpdateSimulatedPosition && (
            <button
              onClick={() => handleWalkCloser()}
              title="Simulate walking closer"
              className="w-10 h-10 sm:w-11 sm:h-11 bg-[#FBEEE1] text-[#F16321] border border-[#EADBC8] rounded-xl shadow-md flex items-center justify-center hover:bg-[#F16321] hover:text-[#FAF4EB] active:scale-95 transition-colors"
            >
              <Footprints className="w-5 h-5" />
            </button>
          )}

          {/* Zoom In */}
          <button
            onClick={() => setZoomAction({ type: 'in' })}
            title="Zoom In"
            className="w-10 h-10 sm:w-11 sm:h-11 bg-white text-[#1A1310] border-2 border-[#1A1310] shadow-[3px_3px_0_#1A1310] flex items-center justify-center hover:bg-[#FDE8D7] active:translate-x-0.5 active:translate-y-0.5 transition-transform"
          >
            <Plus className="w-5 h-5" />
          </button>

          {/* Zoom Out */}
          <button
            onClick={() => setZoomAction({ type: 'out' })}
            title="Zoom Out"
            className="w-10 h-10 sm:w-11 sm:h-11 bg-white text-[#1A1310] border-2 border-[#1A1310] shadow-[3px_3px_0_#1A1310] flex items-center justify-center hover:bg-[#FDE8D7] active:translate-x-0.5 active:translate-y-0.5 transition-transform"
          >
            <Minus className="w-5 h-5" />
          </button>
        </div>

        {/* Floating Nearest Spawn Quick Card (When no specific pin or landmark is opened) */}
        {!selectedSpawn && !selectedLandmark && nearestResult && nearestResult.spawn.status === 'active' && (
          <div className="absolute left-3 right-3 bottom-4 z-20 pointer-events-auto">
            <div
              onClick={() => handleSelectSpawn(nearestResult.spawn)}
              className="bg-[#FAF4EB]/95 backdrop-blur-md border border-[#EADBC8] p-3 rounded-2xl shadow-lg flex items-center justify-between cursor-pointer hover:border-[#F16321] transition-all"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#FBEEE1] border border-[#EADBC8] flex items-center justify-center text-[#F16321] shrink-0 font-bold font-display">
                  +{nearestResult.spawn.points}
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#F16321] font-mono">
                      NEAREST POINT
                    </span>
                    <span className="text-[10px] text-[#70625B] font-mono">
                      · {nearestResult.distanceMeters}m away
                    </span>
                  </div>
                  <span className="text-xs font-bold text-[#1A1310] truncate font-display">
                    {nearestResult.spawn.title}
                  </span>
                  <span className="text-[10px] text-[#70625B] truncate font-body">
                    {nearestResult.spawn.zoneName}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-2">
                <Button
                  size="sm"
                  variant={nearestResult.distanceMeters <= nearestResult.spawn.claimRadiusMeters ? 'primary' : 'outline'}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectSpawn(nearestResult.spawn);
                  }}
                >
                  {nearestResult.distanceMeters <= nearestResult.spawn.claimRadiusMeters ? 'CLAIM' : 'VIEW'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Selected Landmark Detail Bottom Sheet (Non-modal with hasBackdrop={false} so spawn pins and bare map win tap priority) */}
      {selectedLandmark && !selectedSpawn && (
        <BottomSheet
          isOpen={true}
          onClose={() => setSelectedLandmark(null)}
          hasBackdrop={false}
          showHandle={true}
        >
          <LandmarkDetailSheet
            landmark={selectedLandmark}
            nearestSpawn={getNearestActiveSpawn(selectedLandmark, spawns)}
            nearbySpawns={getNearbySpawnsForLandmark(selectedLandmark, spawns)}
            playerLat={playerLat}
            playerLng={playerLng}
            onSelectSpawn={(spawn) => {
              setSelectedLandmark(null);
              handleSelectSpawn(spawn);
            }}
            onClaimSpawn={handleClaim}
            onClose={() => setSelectedLandmark(null)}
          />
        </BottomSheet>
      )}

      {/* Screens 04 & 04a: Selected Spawn Full Detail Bottom Sheet */}
      {selectedSpawn && (
        <BottomSheet
          isOpen={true}
          onClose={() => setSelectedSpawn(null)}
          title={selectedSpawn.title}
        >
          <PointDetailSheet
            spawn={selectedSpawn}
            zone={selectedZone}
            playerLat={playerLat}
            playerLng={playerLng}
            onClaim={handleClaim}
            onClose={() => setSelectedSpawn(null)}
            onWalkCloser={handleWalkCloser}
          />
        </BottomSheet>
      )}

      {/* Screen 03d: Unobtrusive Map Layers & Native Landmark Legend */}
      <BottomSheet
        isOpen={showLegend}
        onClose={() => setShowLegend(false)}
        title="Map Layers & Legend"
      >
        <div className="flex flex-col gap-4 pb-2 text-[#1A1310]">
          {/* Layer Toggles */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#70625B] font-mono">
              Map Layers
            </span>
            <div className="flex items-center justify-between p-3 rounded-2xl border border-[#EADBC8] bg-[#FAF4EB]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#FBEEE1] border border-[#EADBC8] flex items-center justify-center text-[#F16321]">
                  <Layers className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-[#1A1310] font-display">
                    Campus Zones Overlay
                  </span>
                  <span className="text-[10px] text-[#70625B] font-body">
                    12% tint & thin #F16321 dashed outline
                  </span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showZoneOverlay}
                onClick={() => setShowZoneOverlay(!showZoneOverlay)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  showZoneOverlay ? 'bg-[#F16321]' : 'bg-[#EADBC8]'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    showZoneOverlay ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Native Landmark Categories Section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#70625B] font-mono">
                Native Landmark Colors
              </span>
              <span className="text-[10px] font-mono text-[#70625B]">Group 2-2.svg</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2.5 p-2 rounded-xl border bg-[#F8F3EA] border-[#EADBC8]">
                <div
                  className="w-5 h-5 rounded-lg shrink-0 border border-[#1A1310]/30 shadow-2xs"
                  style={{ backgroundColor: MAP_PALETTE.campusBase }}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold font-display leading-tight text-[#1A1310]">
                    Campus Base
                  </span>
                  <span className="text-[10px] font-mono text-[#70625B]">
                    #F8F3EA
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded-xl border bg-[#FAF4EB] border-[#EADBC8]">
                <div
                  className="w-5 h-5 rounded-lg shrink-0 border border-black shadow-2xs"
                  style={{ backgroundColor: MAP_PALETTE.outline }}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold font-display leading-tight text-[#1A1310]">
                    Boundaries
                  </span>
                  <span className="text-[10px] font-mono text-[#70625B]">
                    #000000
                  </span>
                </div>
              </div>
              {Object.entries(MAP_PALETTE.categories).map(([key, cat]) => (
                <div
                  key={key}
                  className="flex items-center gap-2.5 p-2 rounded-xl border"
                  style={{ backgroundColor: cat.bg, borderColor: cat.border }}
                >
                  <div
                    className="w-5 h-5 rounded-lg shrink-0 border border-black/30 shadow-2xs"
                    style={{ backgroundColor: cat.fill }}
                  />
                  <div className="flex flex-col min-w-0">
                    <span
                      className="text-xs font-bold font-display leading-tight truncate"
                      style={{ color: cat.color }}
                    >
                      {cat.name}
                    </span>
                    <span className="text-[10px] font-mono text-[#70625B] truncate">
                      {cat.fill}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Game State Callout */}
          <div className="p-3 rounded-2xl bg-[#FFF8F2] border border-[#F16321]/30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div
                className="w-5 h-5 rounded-lg shrink-0 border border-[#D44E11] shadow-2xs"
                style={{ backgroundColor: MAP_PALETTE.activeGameState.highlight }}
              />
              <div className="flex flex-col">
                <span className="text-xs font-bold font-display text-[#D44E11]">
                  Active Game State
                </span>
                <span className="text-[10px] text-[#70625B] leading-snug">
                  Spawn pins, player radar, claim CTA & tapped landmark outline
                </span>
              </div>
            </div>
            <span className="text-[10px] font-mono font-bold text-[#F16321] shrink-0">
              #F16321
            </span>
          </div>
        </div>
      </BottomSheet>

      {/* Screen 05: Claim Confirmation Modal */}
      {claimModalData && (
        <ClaimConfirmationModal
          isOpen={claimModalData.isOpen}
          spawn={claimModalData.spawn}
          pointsEarned={claimModalData.pointsEarned}
          oldRank={claimModalData.oldRank}
          newRank={claimModalData.newRank}
          updatedWeeklyPoints={claimModalData.updatedWeeklyPoints}
          updatedTotalPoints={claimModalData.updatedTotalPoints}
          onClose={() => setClaimModalData(null)}
        />
      )}

      {/* Screen 03a: Location Denied Modal */}
      {showLocationDeniedModal && (
        <div className="fixed inset-0 z-50 bg-[#1A1310]/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-sm bg-[#F4EFE6] border-[3px] border-[#1A1310] p-5 sm:p-6 shadow-[5px_5px_0_#F16321] flex flex-col items-center text-center gap-4">
            <div className="w-14 h-14 bg-[#FDE8D7] border-2 border-[#1A1310] flex items-center justify-center text-[#F16321]">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="flex flex-col gap-1.5">
              <h3 className="text-base font-bold font-display text-[#1A1310]">
                LOCATION PERMISSION REQUIRED
              </h3>
              <p className="text-xs text-[#70625B] leading-relaxed font-body">
                I9 relies on real campus GPS to verify that you are physically within proximity of spawn points when claiming.
              </p>
            </div>

            <div className="w-full flex flex-col gap-2 mt-2">
              <Button
                variant="primary"
                className="w-full"
                onClick={() => {
                  if (onToggleSimulatedGps) onToggleSimulatedGps();
                  setShowLocationDeniedModal(false);
                }}
              >
                ENABLE CAMPUS SIMULATED GPS
              </Button>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  window.location.reload();
                }}
              >
                RETRY BROWSER GEOLOCATION
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
