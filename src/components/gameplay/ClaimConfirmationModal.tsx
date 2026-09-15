import React from 'react';
import { SpawnPoint } from '../../types';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { Check, ArrowUp, Flame, MapPin, Compass } from 'lucide-react';
import { formatNumber } from '../../lib/utils';

export interface ClaimConfirmationModalProps {
  isOpen: boolean;
  spawn: SpawnPoint;
  pointsEarned: number;
  oldRank: number;
  newRank: number;
  updatedWeeklyPoints: number;
  updatedTotalPoints: number;
  onClose: () => void;
}

export const ClaimConfirmationModal: React.FC<ClaimConfirmationModalProps> = ({
  isOpen,
  spawn,
  pointsEarned,
  oldRank,
  newRank,
  updatedWeeklyPoints,
  updatedTotalPoints,
  onClose,
}) => {
  if (!isOpen) return null;

  const rankClimbed = newRank < oldRank;
  const rankDiff = oldRank - newRank;

  return (
    <div className="fixed inset-0 z-50 bg-[#1A1310]/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-sm bg-[#F4EFE6] border-[3px] border-[#1A1310] p-5 sm:p-6 shadow-[5px_5px_0_#F16321] flex flex-col gap-5 text-[#1A1310] animate-in fade-in zoom-in-95 duration-200">
        {/* Restrained Success Icon Badge */}
        <div className="flex items-center justify-between">
          <div className="w-12 h-12 bg-[#FDE8D7] border-2 border-[#1A1310] text-[#F16321] flex items-center justify-center">
            <Check className="w-6 h-6 stroke-[3]" />
          </div>

          <div className="flex items-center gap-2">
            <Pill variant="neutral" size="sm">
              {spawn.code}
            </Pill>
            <Pill variant="tier" size="sm">
              {spawn.tier.toUpperCase()}
            </Pill>
          </div>
        </div>

        {/* Points Earned Banner */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#70625B]">
            POINT CLAIM CONFIRMED
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold font-display text-[#F16321] tracking-tight">
              +{pointsEarned}
            </span>
            <span className="text-base font-bold font-display text-[#1A1310]">
              POINTS
            </span>
          </div>
          <span className="text-xs text-[#70625B] font-body mt-0.5">
            Claimed at <strong className="text-[#1A1310]">{spawn.title}</strong>
          </span>
        </div>

        {/* Updated Standings Box */}
        <div className="bg-white border-2 border-[#1A1310] p-4 flex flex-col gap-3">
          {/* Weekly Score */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-[#70625B]">
              <Flame className="w-4 h-4 text-[#F16321] fill-[#F16321]" />
              <span>Weekly Score</span>
            </div>
            <span className="text-sm font-bold font-mono text-[#1A1310]">
              {formatNumber(updatedWeeklyPoints)} PTS
            </span>
          </div>

          {/* Campus Rank */}
          <div className="flex items-center justify-between pt-2 border-t border-[#EADBC8]">
            <div className="flex items-center gap-2 text-xs text-[#70625B]">
              <span>Weekly Campus Rank</span>
            </div>
            <div className="flex items-center gap-2">
              {rankClimbed ? (
                <div className="flex items-center gap-1 text-xs font-bold text-[#F16321] font-mono">
                  <span className="text-[#70625B] line-through font-normal">#{oldRank}</span>
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>#{newRank}</span>
                  <span className="text-[10px] bg-[#F16321] text-white px-1.5 py-0.2 font-bold">
                    +{rankDiff}
                  </span>
                </div>
              ) : (
                <span className="text-sm font-bold font-mono text-[#1A1310]">
                  #{newRank}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Single Restrained Return Action */}
        <div className="w-full pt-1">
          <Button
            variant="primary"
            className="w-full py-3.5 text-sm font-bold"
            onClick={onClose}
          >
            RETURN TO CAMPUS MAP
          </Button>
        </div>
      </div>
    </div>
  );
};
