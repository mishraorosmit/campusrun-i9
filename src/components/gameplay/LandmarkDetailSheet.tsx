import React, { useState } from 'react';
import { CampusLandmark, getNearestActiveSpawn } from '../../data/landmarks';
import { getLandmarkCategoryToken } from '../../styles/tokens';
import { SpawnPoint } from '../../types';
import { Button } from '../ui/Button';
import { MapPin, X, Zap, ChevronRight, Loader2, Sparkles } from 'lucide-react';

export interface LandmarkDetailSheetProps {
  landmark: CampusLandmark;
  nearestSpawn?: {
    spawn: SpawnPoint;
    distanceMeters: number;
  } | null;
  nearbySpawns?: SpawnPoint[];
  playerLat?: number;
  playerLng?: number;
  onSelectSpawn: (spawn: SpawnPoint) => void;
  onClaimSpawn?: (spawnId: string) => Promise<void>;
  onClose: () => void;
}

export const LandmarkDetailSheet: React.FC<LandmarkDetailSheetProps> = ({
  landmark,
  nearestSpawn,
  nearbySpawns,
  onSelectSpawn,
  onClaimSpawn,
  onClose,
}) => {
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const categoryToken = getLandmarkCategoryToken(landmark.category, landmark.id);

  // Compute nearest spawn if not directly passed
  const activeNearest =
    nearestSpawn !== undefined
      ? nearestSpawn
      : nearbySpawns
      ? getNearestActiveSpawn(landmark, nearbySpawns)
      : null;

  const handleDirectClaim = async (e: React.MouseEvent, spawnId: string) => {
    e.stopPropagation();
    if (!onClaimSpawn || claimingId) return;
    setClaimingId(spawnId);
    try {
      await onClaimSpawn(spawnId);
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-[#1A1310] select-none pb-1">
      {/* Category header & Close */}
      <div className="flex items-center justify-between gap-2">
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold uppercase tracking-wider font-mono"
          style={{
            backgroundColor: categoryToken.bg,
            borderColor: categoryToken.border,
            color: categoryToken.color,
          }}
        >
          <span
            className="w-2.5 h-2.5 rounded-full border border-black/30 shrink-0"
            style={{ backgroundColor: categoryToken.fill }}
          />
          {landmark.categoryLabel}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-2 border-2 border-[#1A1310] text-[#70625B] hover:text-[#1A1310] hover:bg-[#FDE8D7] transition-colors"
          aria-label="Close landmark detail"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Real Name */}
      <div>
        <h2 className="text-base sm:text-lg font-bold font-display tracking-tight text-[#1A1310]">
          {landmark.name}
        </h2>
      </div>

      {/* Nearest Active Spawn */}
      <div className="flex flex-col gap-1.5 pt-0.5">
        <div className="flex items-center gap-1 text-[11px] font-bold font-display uppercase tracking-wider text-[#70625B]">
          <Sparkles className="w-3 h-3 text-[#F16321]" />
          <span>Nearest Active Spawn</span>
        </div>

        {activeNearest ? (
          <div
            onClick={() => onSelectSpawn(activeNearest.spawn)}
            className="p-3 border-2 border-[#1A1310] bg-white hover:bg-[#FDE8D7] transition-all flex items-center justify-between gap-3 shadow-[2px_2px_0_#1A1310] cursor-pointer active:translate-x-0.5 active:translate-y-0.5"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Points Badge */}
              <div className="w-9 h-9 bg-[#F16321] text-white font-display font-bold text-xs flex items-center justify-center shrink-0 border-2 border-[#1A1310]">
                +{activeNearest.spawn.points}
              </div>

              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-[#1A1310] font-display truncate">
                  {activeNearest.spawn.title}
                </span>
                <span className="text-[10px] font-mono text-[#70625B] flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 text-[#F16321] shrink-0" />
                  <span>{activeNearest.distanceMeters}m away</span>
                  <span>·</span>
                  <span className="text-[#F16321] uppercase font-bold">
                    {activeNearest.spawn.tier}
                  </span>
                </span>
              </div>
            </div>

            <div className="shrink-0">
              {activeNearest.distanceMeters <= activeNearest.spawn.claimRadiusMeters &&
              onClaimSpawn ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={claimingId === activeNearest.spawn.id}
                  className="text-xs px-3 shadow-xs font-bold"
                  onClick={(e) => handleDirectClaim(e, activeNearest.spawn.id)}
                >
                  {claimingId === activeNearest.spawn.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 mr-1" />
                      CLAIM
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs px-2.5 font-medium text-[#1A1310] hover:text-[#F16321]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSpawn(activeNearest.spawn);
                  }}
                >
                  VIEW
                  <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-2.5 border-2 border-[#1A1310] bg-white text-xs text-[#70625B] flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-[#70625B]/50 shrink-0" />
            <span>No active spawn nearby at this time</span>
          </div>
        )}
      </div>
    </div>
  );
};
