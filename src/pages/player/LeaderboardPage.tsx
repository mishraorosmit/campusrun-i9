import React, { useState } from 'react';
import { LeaderboardEntry } from '../../types';
import { LeaderboardRow } from '../../components/ui/LeaderboardRow';
import { Trophy, Flame, Clock, Users, ArrowUp, ArrowDown } from 'lucide-react';
import { formatNumber } from '../../lib/utils';

export interface LeaderboardPageProps {
  entries: LeaderboardEntry[];
  allTimeEntries?: LeaderboardEntry[];
  currentUserId?: string;
}

export const LeaderboardPage: React.FC<LeaderboardPageProps> = ({
  entries,
  allTimeEntries = [],
  currentUserId,
}) => {
  const [period, setPeriod] = useState<'week' | 'all-time'>('week');

  const currentList = period === 'week' ? entries : allTimeEntries.length > 0 ? allTimeEntries : entries;

  // Find current player entry in active list
  const currentPlayerEntry = currentList.find(
    (e) => e.isCurrentUser || e.playerId === currentUserId || e.playerId === 'player-you'
  );

  return (
    <div className="relative flex-1 w-full h-full bg-[#F4EFE6] flex flex-col overflow-hidden">
      {/* Top Header & Tab Filter */}
      <div className="p-3 sm:p-4 bg-white border-b-[3px] border-[#1A1310] shrink-0 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-xl font-bold font-display tracking-tight text-[#1A1310]">
              CAMPUS BOARD
            </h1>
            <span className="text-[10px] sm:text-xs text-[#70625B] font-mono uppercase">
              Real-time campus standings
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#FDE8D7] border-2 border-[#1A1310] text-[10px] font-mono text-[#F16321]">
            <Clock className="w-3.5 h-3.5" />
            <span>RESET 2D 14H</span>
          </div>
        </div>

        {/* Tab Switcher: This Week | All-time */}
        <div className="grid grid-cols-2 p-1 bg-[#F4EFE6] border-2 border-[#1A1310]">
          <button
            type="button"
            onClick={() => setPeriod('week')}
              className={`py-2 text-xs font-bold font-display transition-all ${
              period === 'week'
                ? 'bg-[#1A1310] text-white'
                : 'text-[#70625B] hover:text-[#1A1310]'
            }`}
          >
            THIS WEEK
          </button>
          <button
            type="button"
            onClick={() => setPeriod('all-time')}
              className={`py-2 text-xs font-bold font-display transition-all ${
              period === 'all-time'
                ? 'bg-[#1A1310] text-white'
                : 'text-[#70625B] hover:text-[#1A1310]'
            }`}
          >
            ALL-TIME
          </button>
        </div>
      </div>

      {/* Scrollable Leaderboard List */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-2 pb-24">
        {currentList.map((entry) => (
          <LeaderboardRow
            key={`${entry.playerId}-${entry.rank}`}
            entry={entry}
          />
        ))}
      </div>

      {/* Pinned Current Player Row at Bottom (Screen 06 Requirement) */}
      {currentPlayerEntry && (
        <div className="absolute bottom-0 left-0 right-0 p-3 bg-white border-t-[3px] border-[#1A1310] shadow-[0_-4px_0_rgba(26,19,16,0.08)] z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Current Rank Badge */}
              <div className="w-8 h-8 bg-[#F16321] text-white flex items-center justify-center font-bold font-display text-sm">
                #{currentPlayerEntry.rank}
              </div>

              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold font-display text-[#1A1310]">
                    {currentPlayerEntry.username}
                  </span>
                  <span className="text-[10px] bg-[#FDE8D7] text-[#F16321] border border-[#1A1310] px-1.5 py-0.2 font-bold font-mono">
                    YOU
                  </span>
                </div>
                <span className="text-[11px] text-[#70625B] font-mono">
                  {currentPlayerEntry.claimsCount} claims completed
                </span>
              </div>
            </div>

            <div className="flex flex-col items-end">
              <span className="text-base font-extrabold font-mono text-[#F16321]">
                {formatNumber(currentPlayerEntry.points)} PTS
              </span>
              <div className="flex items-center gap-1 text-[10px] font-mono text-[#70625B]">
                {currentPlayerEntry.rankChange === 'up' && (
                  <span className="text-[#7A9B76] font-bold flex items-center">
                    <ArrowUp className="w-3 h-3 inline" /> UP
                  </span>
                )}
                {currentPlayerEntry.rankChange === 'down' && (
                  <span className="text-[#D44E11] font-bold flex items-center">
                    <ArrowDown className="w-3 h-3 inline" /> DOWN
                  </span>
                )}
                <span>· {period === 'week' ? 'WEEKLY' : 'TOTAL'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
