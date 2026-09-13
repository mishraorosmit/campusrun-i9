import React from 'react';
import { cn, formatNumber } from '../../lib/utils';
import { LeaderboardEntry } from '../../types';
import { Avatar } from './Avatar';
import { Pill } from './Pill';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

export interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  onClick?: (entry: LeaderboardEntry) => void;
  className?: string;
}

export const LeaderboardRow: React.FC<LeaderboardRowProps> = ({
  entry,
  onClick,
  className,
}) => {
  const isTop3 = entry.rank <= 3;
  const isSelf = entry.isCurrentUser;

  const rankColors = {
    1: 'bg-[#F16321] text-[#FBF6EE]',
    2: 'bg-[#1A1310] text-[#FBF6EE]',
    3: 'bg-[#FBEEE1] text-[#D44E11] border border-[#EADBC8]',
  };

  return (
    <div
      onClick={() => onClick && onClick(entry)}
      className={cn(
        'flex items-center justify-between p-3 rounded-sm transition-all select-none min-h-[56px]',
        isSelf
          ? 'bg-[#FDE8D7] border-2 border-[#1A1310] shadow-[3px_3px_0_#F16321]'
          : 'bg-white border-2 border-[#1A1310] hover:bg-[#FDE8D7]',
        onClick && 'cursor-pointer active:scale-[0.99]',
        className
      )}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Rank Badge */}
        <div
          className={cn(
            'w-7 h-7 flex items-center justify-center font-bold font-display text-xs shrink-0',
            isTop3
              ? rankColors[entry.rank as 1 | 2 | 3]
              : 'bg-[#F4EFE6] text-[#70625B] font-semibold'
          )}
        >
          {entry.rank}
        </div>

        {/* Avatar */}
        <Avatar name={entry.username} src={entry.avatarUrl} size="sm" tier={entry.tier} />

        {/* Details */}
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-sm font-bold truncate font-body',
                isSelf ? 'text-[#F16321]' : 'text-[#1A1310]'
              )}
            >
              {entry.username}
            </span>
            {isSelf && (
                <span className="text-[10px] px-1.5 py-0.2 bg-[#F16321] text-white font-display uppercase tracking-wider font-semibold">
                You
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-[#70625B]">
            <span>{entry.claimsCount} claims</span>
            <span>•</span>
            <Pill tier={entry.tier} size="xs">
              {entry.tier.toUpperCase()}
            </Pill>
          </div>
        </div>
      </div>

      {/* Points & Trend */}
      <div className="flex items-center gap-2 shrink-0 text-right">
        <div className="flex flex-col items-end">
          <span className="text-sm font-bold font-display text-[#1A1310]">
            {formatNumber(entry.points)}
          </span>
          <span className="text-[10px] text-[#70625B] leading-none uppercase tracking-wide">
            pts
          </span>
        </div>

        <div className="w-5 flex justify-center">
          {entry.rankChange === 'up' && (
            <ArrowUp className="w-3.5 h-3.5 text-[#2E7D32]" />
          )}
          {entry.rankChange === 'down' && (
            <ArrowDown className="w-3.5 h-3.5 text-[#D32F2F]" />
          )}
          {entry.rankChange === 'same' && (
            <Minus className="w-3.5 h-3.5 text-[#9B8C84]" />
          )}
        </div>
      </div>
    </div>
  );
};
