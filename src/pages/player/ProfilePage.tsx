import React, { useState } from 'react';
import { PlayerProfile, ClaimRecord } from '../../types';
import { Avatar } from '../../components/ui/Avatar';
import { Pill } from '../../components/ui/Pill';
import { StatCard } from '../../components/ui/StatCard';
import { Toggle } from '../../components/ui/Toggle';
import { Button } from '../../components/ui/Button';
import {
  Bell,
  Flame,
  Award,
  Clock,
  LogOut,
  MapPin,
  CheckCircle2,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { formatNumber, formatRelativeTime } from '../../lib/utils';

export interface ProfilePageProps {
  player: PlayerProfile;
  claims: ClaimRecord[];
  onSignOut?: () => void;
  onTogglePush?: (enabled: boolean) => void;
  onOpenNotifications?: () => void;
  unreadNotificationsCount?: number;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  player,
  claims,
  onSignOut,
  onTogglePush,
  onOpenNotifications,
  unreadNotificationsCount = 0,
}) => {
  const [pushEnabled, setPushEnabled] = useState(true);

  const handlePushChange = (val: boolean) => {
    setPushEnabled(val);
    onTogglePush?.(val);
  };

  return (
    <div className="flex-1 w-full h-full bg-[#F4EFE6] flex flex-col overflow-y-auto p-3 sm:p-4 gap-3 sm:gap-4 pb-20">
      {/* Player Header Identity (Screen 07) */}
      <div className="p-3 sm:p-4 bg-white border-2 border-[#1A1310] flex items-center justify-between gap-3 shadow-[3px_3px_0_#1A1310]">
        <div className="flex items-center gap-3.5 min-w-0">
          <Avatar name={player.username} size="lg" tier={player.tier} showBadge />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold font-display text-[#1A1310] truncate">
                {player.username}
              </h2>
              <Pill variant="neutral" size="xs">
                {player.tier.toUpperCase()}
              </Pill>
            </div>
            <span className="text-xs text-[#70625B] font-mono truncate mt-0.5">
              {player.email}
            </span>
            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-[#F16321] font-bold">
              <Flame className="w-3.5 h-3.5 fill-[#F16321]" />
              <span>Rank #{player.rank} This Week</span>
            </div>
          </div>
        </div>

        {/* Notifications Icon Button */}
        {onOpenNotifications && (
          <button
            onClick={onOpenNotifications}
            className="relative p-2.5 bg-[#FDE8D7] border-2 border-[#1A1310] text-[#1A1310] hover:text-[#F16321] transition-colors"
            title="Open Notifications Feed"
          >
            <Bell className="w-5 h-5" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#F16321] text-[#FAF4EB] rounded-full text-[9px] font-bold flex items-center justify-center font-mono">
                {unreadNotificationsCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Stats Overview Grid (Screen 07) */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 bg-white border-2 border-[#1A1310] flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase text-[#70625B]">WEEKLY PTS</span>
          <span className="text-base font-extrabold font-mono text-[#F16321]">
            {formatNumber(player.seasonPoints)}
          </span>
        </div>

        <div className="p-3 bg-white border-2 border-[#1A1310] flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase text-[#70625B]">ALL-TIME PTS</span>
          <span className="text-base font-bold font-mono text-[#1A1310]">
            {formatNumber(player.totalPoints)}
          </span>
        </div>

        <div className="p-3 bg-white border-2 border-[#1A1310] flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase text-[#70625B]">TOTAL CLAIMS</span>
          <span className="text-base font-bold font-mono text-[#1A1310]">
            {player.claimsCount}
          </span>
        </div>
      </div>

      {/* Notification Preferences (Screen 07) */}
      <div className="p-4 bg-white border-2 border-[#1A1310] flex flex-col gap-3 shadow-[3px_3px_0_#1A1310]">
        <span className="text-xs font-bold font-display uppercase tracking-wider text-[#70625B]">
          PREFERENCES
        </span>

        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs font-bold text-[#1A1310]">
              Spawn Drop & Rotation Push Alerts
            </span>
            <span className="text-[11px] text-[#70625B]">
              Notify when new spawns appear within 50m
            </span>
          </div>
          <Toggle
            checked={pushEnabled}
            onChange={handlePushChange}
            aria-label="Toggle Push Alerts"
          />
        </div>
      </div>

      {/* Complete Claim History (Screen 07 Requirement) */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold font-display uppercase tracking-wider text-[#70625B]">
            CLAIM HISTORY ({claims.length})
          </span>
          <span className="text-[11px] font-mono text-[#70625B]">
            All verified claims
          </span>
        </div>

        {claims.length === 0 ? (
          <div className="p-6 bg-white border-2 border-[#1A1310] text-center flex flex-col items-center gap-2 text-[#70625B]">
            <Award className="w-8 h-8 opacity-40 text-[#70625B]" />
            <span className="text-xs font-bold text-[#1A1310]">NO CLAIMS YET</span>
            <p className="text-[11px]">
              Walk to active campus spawns on the map to start claiming points.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {claims.map((claim) => (
              <div
                key={claim.id}
                className="p-3 bg-white border-2 border-[#1A1310] flex items-center justify-between gap-3 shadow-[2px_2px_0_#1A1310]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 bg-[#FDE8D7] border border-[#1A1310] text-[#F16321] flex items-center justify-center font-bold text-xs shrink-0">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-[#1A1310] truncate font-display">
                        {claim.spawnTitle}
                      </span>
                      <span className="text-[10px] font-mono text-[#70625B]">
                        {claim.spawnCode}
                      </span>
                    </div>
                    <span className="text-[10px] text-[#70625B] truncate font-body">
                      {claim.zoneName} · {formatRelativeTime(claim.claimedAt)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 font-mono font-bold text-xs text-[#F16321]">
                  +{claim.pointsAwarded} PTS
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sign Out Action */}
      {onSignOut && (
        <div className="pt-2">
          <Button
            variant="outline"
            className="w-full text-xs text-[#70625B] hover:text-[#1A1310]"
            onClick={onSignOut}
          >
            <LogOut className="w-3.5 h-3.5 mr-1.5" />
            SIGN OUT (END SESSION)
          </Button>
        </div>
      )}
    </div>
  );
};
