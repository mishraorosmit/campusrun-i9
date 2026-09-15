import React, { useState } from 'react';
import { TabBar } from '../components/ui/TabBar';
import { PlayerNavTab, PlayerProfile, RotationState, AppNotification } from '../types';
import { formatDuration, formatNumber } from '../lib/utils';
import { Clock, Flame, ShieldAlert, Bell, Menu, Navigation } from 'lucide-react';
import { NotificationsDrawer } from '../components/notifications/NotificationsDrawer';

export interface PlayerLayoutProps {
  activeTab: PlayerNavTab;
  onTabChange: (tab: PlayerNavTab) => void;
  player: PlayerProfile;
  rotation: RotationState;
  notifications: AppNotification[];
  onMarkNotificationAsRead: (id: string) => void;
  onSwitchToAdmin?: () => void;
  onToggleTracking?: () => void;
  children: React.ReactNode;
}

export const PlayerLayout: React.FC<PlayerLayoutProps> = ({
  activeTab,
  onTabChange,
  player,
  rotation,
  notifications,
  onMarkNotificationAsRead,
  onSwitchToAdmin,
  onToggleTracking,
  children,
}) => {
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="relative flex flex-col h-full w-full bg-[#FBF6EE] text-[#1A1310] overflow-hidden select-none">
      {/* Top Header Bar */}
      <header className="h-[72px] px-3 sm:px-4 bg-white border-b-[3px] border-[#1A1310] flex items-center justify-between shrink-0 z-[30]">
        {/* Brand / Game Identity */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-11 sm:h-11 bg-[#1A1310] text-white flex items-center justify-center font-bold font-display text-base sm:text-lg tracking-tighter shrink-0">
            CL
          </div>
          <div className="flex flex-col">
            <span className="text-[15px] sm:text-xl font-bold font-display tracking-tight text-[#1A1310] leading-none whitespace-nowrap">
              [ CAMPUSLINK ]
            </span>
            <span className="text-[8px] sm:text-[11px] text-[#70625B] leading-none font-mono tracking-[0.14em] sm:tracking-[0.2em] mt-1 whitespace-nowrap">
              ITER, SOA UNIVERSITY
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleTracking}
            className="hidden sm:flex items-center gap-2 border-2 border-[#1A1310] px-4 py-2 text-sm font-bold font-display uppercase"
            title="Center on my location"
          >
            <Navigation className="w-4 h-4 text-[#F16321]" />
            Tracker
          </button>
          <button
            onClick={() => setIsNotificationsOpen(true)}
            title="Campus Notifications"
            className="relative p-2 text-[#1A1310] hover:text-[#F16321] transition-colors cursor-pointer"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-[#F16321] rounded-full ring-2 ring-[#FAF4EB]" />
            )}
          </button>

          {onSwitchToAdmin && (
            <button
              onClick={onSwitchToAdmin}
              title="Admin Panel"
              className="p-2 text-[#1A1310] hover:text-[#F16321] transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
          )}
        </div>
      </header>

      {/* Main Screen Viewport Container */}
      <main className="flex-1 overflow-hidden relative w-full flex flex-col">
        {children}
      </main>

      {/* Persistent Mobile Bottom Navigation Bar (Map, Leaderboard, Profile) */}
      <TabBar
        activeTab={activeTab}
        onTabChange={onTabChange}
        activeSpawnsBadge={rotation.totalActiveSpawns}
        claimBadgeCount={player.claimsCount}
      />

      {/* Screen 08: Notifications Drawer */}
      <NotificationsDrawer
        isOpen={isNotificationsOpen}
        notifications={notifications}
        onClose={() => setIsNotificationsOpen(false)}
        onMarkAsRead={onMarkNotificationAsRead}
      />
    </div>
  );
};
