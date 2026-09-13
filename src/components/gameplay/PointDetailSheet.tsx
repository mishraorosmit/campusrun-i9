import React, { useEffect, useState } from 'react';
import { SpawnPoint, CampusZone } from '../../types';
import { Pill } from '../ui/Pill';
import { Button } from '../ui/Button';
import { getTurfDistanceMeters } from '../../lib/geo';
import {
  MapPin,
  Flame,
  Footprints,
  Compass,
  CheckCircle2,
  Sparkles,
  Navigation,
  Timer,
  ArrowRight,
  Radio,
} from 'lucide-react';

export interface PointDetailSheetProps {
  spawn: SpawnPoint;
  zone?: CampusZone | null;
  playerLat: number;
  playerLng: number;
  onClaim: (spawnId: string) => Promise<void>;
  onClose: () => void;
  onWalkCloser?: (spawn: SpawnPoint) => void;
}

export const PointDetailSheet: React.FC<PointDetailSheetProps> = ({
  spawn,
  zone,
  playerLat,
  playerLng,
  onClaim,
  onClose,
  onWalkCloser,
}) => {
  const [isClaiming, setIsClaiming] = useState(false);
  const [autoClaimCountdown, setAutoClaimCountdown] = useState<number>(3);
  const [autoClaimEnabled, setAutoClaimEnabled] = useState<boolean>(true);

  // Exact distance in meters calculated with Turf.js
  const distanceMeters = getTurfDistanceMeters(playerLat, playerLng, spawn.lat, spawn.lng);
  const inRange = distanceMeters <= spawn.claimRadiusMeters;
  const isClaimed = spawn.status === 'claimed';
  const distanceRemaining = Math.max(0, distanceMeters - spawn.claimRadiusMeters);

  // Screen 04: Automatic proximity countdown when in-range
  useEffect(() => {
    if (!inRange || isClaimed || !autoClaimEnabled || isClaiming) {
      return;
    }

    if (autoClaimCountdown <= 0) {
      handleTriggerClaim();
      return;
    }

    const timer = setInterval(() => {
      setAutoClaimCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleTriggerClaim();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [inRange, isClaimed, autoClaimCountdown, autoClaimEnabled, isClaiming]);

  const handleTriggerClaim = async () => {
    if (isClaiming || isClaimed) return;
    setIsClaiming(true);
    try {
      await onClaim(spawn.id);
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 text-[#1A1310]">
      {/* Top Meta Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Pill variant="neutral" size="sm">
            {spawn.code}
          </Pill>
          <Pill variant="tier" size="sm">
            {spawn.tier.toUpperCase()}
          </Pill>
        </div>

        {/* Value Tag */}
          <div className="flex items-center gap-1.5 px-3 py-1 bg-[#FDE8D7] border-2 border-[#1A1310]">
          <Flame className="w-4 h-4 text-[#F16321] fill-[#F16321]" />
          <span className="text-sm font-bold font-display text-[#1A1310]">
            +{spawn.points} PTS
          </span>
        </div>
      </div>

      {/* Point Title & Zone */}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold font-display text-[#1A1310] tracking-tight leading-tight">
          {spawn.title}
        </h2>
        {zone && (
          <div className="flex items-center gap-1.5 text-xs text-[#70625B]">
            <MapPin className="w-3.5 h-3.5 text-[#F16321]" />
            <span className="font-semibold text-[#1A1310]">{zone.name}</span>
            <span className="font-mono text-[11px] text-[#70625B]">({zone.code})</span>
          </div>
        )}
      </div>

      {/* Description & Physical Clue */}
      <div className="bg-white border-2 border-[#1A1310] p-3.5 shadow-[3px_3px_0_#1A1310] flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#70625B]">
          CAMPUS LOCATION & CLUE
        </span>
        <p className="text-xs text-[#1A1310] font-body leading-relaxed">
          {spawn.description || 'Campus landmark point active in current rotation.'}
        </p>
        {spawn.clue && (
          <div className="pt-2 border-t border-[#EADBC8]/70 flex items-start gap-2 text-xs">
            <Compass className="w-3.5 h-3.5 text-[#F16321] shrink-0 mt-0.5" />
            <span className="text-[#70625B] italic font-body">"{spawn.clue}"</span>
          </div>
        )}
      </div>

      {/* Proximity / Range Status Banner */}
      {isClaimed ? (
          <div className="p-3.5 bg-white border-2 border-[#1A1310] flex items-center gap-3">
          <div className="w-9 h-9 bg-[#1A1310] text-white flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-[#FAF4EB]" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-[#1A1310]">ALREADY CLAIMED</span>
            <span className="text-[11px] text-[#70625B]">
              This spawn was claimed in the current rotation cycle.
            </span>
          </div>
        </div>
      ) : inRange ? (
        /* SCREEN 04 — IN RANGE STATE */
        <div className="p-3.5 bg-[#FDE8D7] border-2 border-[#1A1310] shadow-[3px_3px_0_#F16321] flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="relative flex items-center justify-center w-3 h-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F16321] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F16321]" />
              </div>
              <span className="text-xs font-bold font-display uppercase tracking-wider text-[#F16321]">
                IN RANGE ({distanceMeters}M AWAY)
              </span>
            </div>
            <span className="text-[10px] font-mono text-[#70625B]">
              Radius &le;{spawn.claimRadiusMeters}m
            </span>
          </div>

          <p className="text-xs text-[#1A1310] font-body leading-snug">
            You're in range, this will claim automatically.
          </p>

          {/* Auto-claim Progress Indicator */}
          <div className="flex items-center justify-between pt-1 border-t border-[#EADBC8]/80 text-[11px] text-[#70625B]">
            <div className="flex items-center gap-1.5 font-mono">
              <Timer className="w-3.5 h-3.5 text-[#F16321]" />
              <span>Auto-claiming in {autoClaimCountdown}s...</span>
            </div>
            <button
              onClick={() => setAutoClaimEnabled(false)}
              className="text-[10px] text-[#70625B] hover:text-[#1A1310] underline"
            >
              Cancel timer
            </button>
          </div>
        </div>
      ) : (
        /* SCREEN 04A — OUT OF RANGE STATE */
        <div className="p-3.5 bg-white border-2 border-[#1A1310] flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-[#70625B]" />
              <span className="text-xs font-bold font-display uppercase tracking-wider text-[#70625B]">
                OUT OF RANGE
              </span>
            </div>
            <span className="text-xs font-mono font-bold text-[#1A1310]">
              {distanceMeters}m away
            </span>
          </div>

          <div className="text-xs text-[#70625B] leading-relaxed">
            Move <span className="font-bold text-[#1A1310] font-mono">{distanceRemaining}m closer</span> to this landmark to reach the {spawn.claimRadiusMeters}m claim perimeter.
          </div>

          {onWalkCloser && (
            <div className="pt-2 border-t border-[#EADBC8] flex items-center justify-between">
              <span className="text-[10px] text-[#70625B]">Simulation step:</span>
              <button
                onClick={() => onWalkCloser(spawn)}
                className="text-xs font-bold text-[#F16321] hover:underline flex items-center gap-1"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Move onto landmark</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Action Button */}
      <div className="flex flex-col gap-2 mt-1">
        {isClaimed ? (
          <Button variant="outline" disabled className="w-full py-3.5 text-xs text-[#70625B]">
            <CheckCircle2 className="w-4 h-4 mr-2" />
            CLAIMED IN ROTATION
          </Button>
        ) : inRange ? (
          <Button
            variant="primary"
            className="w-full py-3.5 text-sm font-bold shadow-[3px_3px_0_#1A1310] animate-pulse"
            isLoading={isClaiming}
            onClick={handleTriggerClaim}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            CLAIM +{spawn.points} PTS NOW
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled
            className="w-full py-3.5 text-xs text-[#70625B] border-[#1A1310] bg-white cursor-not-allowed"
          >
            <Footprints className="w-4 h-4 mr-2 text-[#70625B]" />
            MOVE CLOSER TO CLAIM ({distanceRemaining}M TO PERIMETER)
          </Button>
        )}

        <Button variant="ghost" size="sm" onClick={onClose} className="text-xs text-[#70625B]">
          Back to Campus Map
        </Button>
      </div>
    </div>
  );
};
