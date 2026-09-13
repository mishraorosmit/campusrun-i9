import React, { useState, useEffect, useCallback } from 'react';
import {
  PlayerNavTab,
  AdminNavTab,
  SpawnPoint,
  CampusZone,
  PlayerProfile,
  ClaimRecord,
  LeaderboardEntry,
  RotationState,
  AppNotification,
} from './types';
import { PlayerLayout } from './layouts/PlayerLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { MobileSimulator } from './layouts/MobileSimulator';
import { MapPage } from './pages/player/MapPage';
import { LeaderboardPage } from './pages/player/LeaderboardPage';
import { ProfilePage } from './pages/player/ProfilePage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { ToastContainer } from './components/ui/Toast';
import { useToast } from './hooks/useToast';
import { useGeoLocation } from './hooks/useGeoLocation';
import { apiGameService as gameService } from './services/apiGameService';
import { LoadingState } from './components/ui/LoadingState';
import { ClaimResult } from './services/types';

export default function App() {
  // Navigation & Mode
  const [currentMode, setCurrentMode] = useState<'player' | 'admin'>('player');
  const [activePlayerTab, setActivePlayerTab] = useState<PlayerNavTab>('map');
  const [activeAdminTab, setActiveAdminTab] = useState<AdminNavTab>('overview');

  useEffect(() => {
    gameService.setRole(currentMode);
  }, [currentMode]);

  // Game State
  const [spawns, setSpawns] = useState<SpawnPoint[]>([]);
  const [zones, setZones] = useState<CampusZone[]>([]);
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [weeklyLeaderboard, setWeeklyLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [allTimeLeaderboard, setAllTimeLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [rotation, setRotation] = useState<RotationState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hooks
  const { toasts, addToast, removeToast } = useToast();
  const {
    lat: playerLat,
    lng: playerLng,
    accuracy: playerAccuracy,
    heading: playerHeading,
    isSimulated: isSimulatingGps,
    toggleSimulation,
    setSimulatedPosition,
    error: locationError,
  } = useGeoLocation({ simulate: true });

  // Initial Data Load & Realtime Subscriptions
  useEffect(() => {
    async function loadInitialData() {
      try {
        const [rot, sps, zns, ply, clms, weeklyLb, allTimeLb, notifs] = await Promise.all([
          gameService.getActiveRotation(),
          gameService.getSpawns(),
          gameService.getZones(),
          gameService.getPlayerProfile(),
          gameService.getClaimsHistory(),
          gameService.getWeeklyLeaderboard(),
          gameService.getAllTimeLeaderboard(),
          gameService.getNotifications(),
        ]);
        setRotation(rot);
        setSpawns(sps);
        setZones(zns);
        setPlayer(ply);
        setClaims(clms);
        setWeeklyLeaderboard(weeklyLb);
        setAllTimeLeaderboard(allTimeLb);
        setNotifications(notifs);
      } catch (err) {
        addToast({
          title: 'Connection Error',
          message: 'Failed to load initial campus game state.',
          type: 'error',
        });
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialData();

    // Supabase / Realtime listener subscriptions
    const unsubSpawns = gameService.subscribeToSpawns((updatedSpawns) => {
      setSpawns(updatedSpawns);
    });

    const unsubLeaderboard = gameService.subscribeToLeaderboard((updatedWeekly) => {
      setWeeklyLeaderboard(updatedWeekly);
    });

    return () => {
      unsubSpawns();
      unsubLeaderboard();
    };
  }, [addToast]);

  const isClaimingRef = React.useRef<boolean>(false);

  // Handle Spawn Claiming
  const handleClaimSpawn = async (spawnId: string): Promise<ClaimResult> => {
    if (isClaimingRef.current) {
      return { success: false, message: 'Claim request already in progress', pointsAwarded: 0 };
    }
    isClaimingRef.current = true;
    
    try {
      const res = await gameService.claimSpawn(spawnId, playerLat, playerLng);
      if (res.success) {
        addToast({
          title: 'Points Claimed!',
          message: res.message,
          type: 'success',
        });
        // Refresh local state from authoritative service
        const [updatedSpawns, updatedPlayer, updatedClaims, updatedWeekly, updatedAllTime, updatedNotifs] =
          await Promise.all([
            gameService.getSpawns(),
            gameService.getPlayerProfile(),
            gameService.getClaimsHistory(),
            gameService.getWeeklyLeaderboard(),
            gameService.getAllTimeLeaderboard(),
            gameService.getNotifications(),
          ]);
        setSpawns(updatedSpawns);
        setPlayer(updatedPlayer);
        setClaims(updatedClaims);
        setWeeklyLeaderboard(updatedWeekly);
        setAllTimeLeaderboard(updatedAllTime);
        setNotifications(updatedNotifs);
      } else {
        addToast({
          title: 'Claim Denied',
          message: res.message,
          type: 'warning',
        });
      }
      return res;
    } finally {
      isClaimingRef.current = false;
    }
  };

  const handleMarkNotificationAsRead = async (id: string) => {
    await gameService.markNotificationAsRead(id);
    const notifs = await gameService.getNotifications();
    setNotifications(notifs);
  };

  if (isLoading || !player || !rotation) {
    return (
      <div className="h-[100dvh] w-full flex items-center justify-center bg-[#FBF6EE]">
        <LoadingState message="Initializing Project I9..." />
      </div>
    );
  }

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      <MobileSimulator>
        {currentMode === 'player' ? (
          <PlayerLayout
            activeTab={activePlayerTab}
            onTabChange={setActivePlayerTab}
            player={player}
            rotation={rotation}
            notifications={notifications}
            onMarkNotificationAsRead={handleMarkNotificationAsRead}
            onSwitchToAdmin={() => setCurrentMode('admin')}
            onToggleTracking={() => toggleSimulation(!isSimulatingGps)}
          >
            {/* Screen 03 / 04 / 04a / 05: Map & Point Detail Flow */}
            {activePlayerTab === 'map' && (
              <MapPage
                spawns={spawns}
                zones={zones}
                player={player}
                playerLat={playerLat}
                playerLng={playerLng}
                playerAccuracy={playerAccuracy}
                playerHeading={playerHeading}
                onClaimSpawn={handleClaimSpawn}
                isSimulatingGps={isSimulatingGps}
                onToggleSimulatedGps={() => toggleSimulation(!isSimulatingGps)}
                onUpdateSimulatedPosition={setSimulatedPosition}
                locationError={locationError}
              />
            )}

            {/* Screen 06: Leaderboard (This Week & All-time with Pinned Bottom Row) */}
            {activePlayerTab === 'leaderboard' && (
              <LeaderboardPage
                entries={weeklyLeaderboard}
                allTimeEntries={allTimeLeaderboard}
                currentUserId={player.id}
              />
            )}

            {/* Screen 07: Profile & Verified Claim History */}
            {activePlayerTab === 'profile' && (
              <ProfilePage
                player={player}
                claims={claims}
                unreadNotificationsCount={notifications.filter((n) => !n.read).length}
                onSignOut={() =>
                  addToast({
                    title: 'Signed Out',
                    message: 'Campus session ended.',
                    type: 'info',
                  })
                }
                onTogglePush={(enabled) =>
                  addToast({
                    title: enabled ? 'Push Alerts Active' : 'Alerts Paused',
                    message: enabled
                      ? 'You will be notified on spawn rotations and nearby drops.'
                      : 'Notifications disabled.',
                    type: 'info',
                  })
                }
              />
            )}
          </PlayerLayout>
        ) : (
          <AdminLayout
            activeTab={activeAdminTab}
            onTabChange={setActiveAdminTab}
            onBackToGame={() => setCurrentMode('player')}
            activeSpawnsCount={spawns.filter((s) => s.status === 'active' && s.enabled !== false).length}
            rotationNumber={rotation.rotationNumber}
          >
            <AdminDashboardPage
              activeTab={activeAdminTab}
              spawns={spawns}
              zones={zones}
              rotation={rotation}
              onShowToast={addToast}
              onRefreshSpawns={async () => {
                const [updatedSpawns, updatedRot, updatedWeekly, updatedAllTime, updatedPlayer] = await Promise.all([
                  gameService.getSpawns(),
                  gameService.getActiveRotation(),
                  gameService.getWeeklyLeaderboard(),
                  gameService.getAllTimeLeaderboard(),
                  gameService.getPlayerProfile(),
                ]);
                setSpawns(updatedSpawns);
                setRotation(updatedRot);
                setWeeklyLeaderboard(updatedWeekly);
                setAllTimeLeaderboard(updatedAllTime);
                setPlayer(updatedPlayer);
              }}
            />
          </AdminLayout>
        )}
      </MobileSimulator>
    </>
  );
}
