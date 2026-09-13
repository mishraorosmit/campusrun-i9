import React from 'react';
import { AppNotification } from '../../types';
import { Pill } from '../ui/Pill';
import { Button } from '../ui/Button';
import {
  Bell,
  X,
  Flame,
  CheckCircle2,
  Clock,
  Compass,
  MapPin,
  Sparkles,
  ArrowUp,
} from 'lucide-react';
import { formatRelativeTime } from '../../lib/utils';

export interface NotificationsDrawerProps {
  isOpen: boolean;
  notifications: AppNotification[];
  onClose: () => void;
  onMarkAsRead: (id: string) => void;
  onClearAll?: () => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  isOpen,
  notifications,
  onClose,
  onMarkAsRead,
  onClearAll,
}) => {
  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  const getIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'nearby_spawn':
        return <Compass className="w-4 h-4 text-[#F16321]" />;
      case 'rank_change':
        return <ArrowUp className="w-4 h-4 text-[#F16321]" />;
      case 'claim_confirmed':
        return <CheckCircle2 className="w-4 h-4 text-[#7A9B76]" />;
      case 'reset_countdown':
        return <Clock className="w-4 h-4 text-[#5B7C99]" />;
      default:
        return <Bell className="w-4 h-4 text-[#70625B]" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#1A1310]/65 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div className="w-full max-w-sm h-full bg-[#F4EFE6] border-l-[3px] border-[#1A1310] flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-4 py-4 border-b-[3px] border-[#1A1310] flex items-center justify-between bg-white">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#F16321]" />
            <h2 className="text-base font-bold font-display text-[#1A1310] tracking-tight">
              NOTIFICATIONS
            </h2>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 bg-[#F16321] text-white text-[10px] font-bold font-mono">
                {unreadCount} NEW
              </span>
            )}
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 border-2 border-[#1A1310] hover:bg-[#FDE8D7] flex items-center justify-center text-[#70625B] hover:text-[#1A1310] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notifications Feed */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
          {notifications.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 gap-2 text-[#70625B]">
              <Bell className="w-8 h-8 opacity-40 text-[#70625B]" />
              <span className="text-sm font-bold font-display text-[#1A1310]">NO NOTIFICATIONS</span>
              <p className="text-xs text-[#70625B]">
                Campus spawn drops, rank climbs, and rotation countdowns will appear here.
              </p>
            </div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => onMarkAsRead(notif.id)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                  notif.read
                    ? 'bg-white border-2 border-[#1A1310] opacity-80'
                    : 'bg-[#FDE8D7] border-2 border-[#1A1310] shadow-[3px_3px_0_#F16321]'
                }`}
              >
                <div className="w-8 h-8 bg-white border-2 border-[#1A1310] flex items-center justify-center shrink-0 mt-0.5">
                  {getIcon(notif.type)}
                </div>

                <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-display text-[#1A1310] truncate">
                      {notif.title}
                    </span>
                    <span className="text-[10px] font-mono text-[#70625B] shrink-0 ml-1">
                      {formatRelativeTime(notif.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-[#70625B] font-body leading-relaxed">
                    {notif.body}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t-[3px] border-[#1A1310] bg-white flex items-center justify-between">
          <span className="text-[11px] text-[#70625B] font-mono">
            Verified campus alerts
          </span>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs text-[#70625B]">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
