import React, { useEffect, useState, useCallback } from 'react';
import {
  AdminNavTab,
  SpawnPoint,
  CampusZone,
  RotationState,
  AdminOverviewStats,
  RotationConfig,
  LeaderboardResetSchedule,
  HeatmapPoint,
} from '../../types';
import { apiGameService as gameService } from '../../services/apiGameService';
import { AdminOverviewTab } from './AdminOverviewTab';
import { AdminPointsTab } from './AdminPointsTab';
import { AdminRotateTab } from './AdminRotateTab';
import { AdminResetTab } from './AdminResetTab';
import { AdminStatsTab } from './AdminStatsTab';
import { LoadingState } from '../../components/ui/LoadingState';

export interface AdminDashboardPageProps {
  activeTab: AdminNavTab;
  spawns: SpawnPoint[];
  zones: CampusZone[];
  rotation: RotationState;
  onRefreshSpawns?: () => void;
  onShowToast?: (toast: { title: string; message?: string; type: 'info' | 'success' | 'warning' | 'error' }) => void;
}

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({
  activeTab,
  spawns: propSpawns,
  zones,
  rotation: propRotation,
  onRefreshSpawns,
  onShowToast,
}) => {
  const [loading, setLoading] = useState(true);
  const [overviewStats, setOverviewStats] = useState<AdminOverviewStats | null>(null);
  const [rotationConfig, setRotationConfig] = useState<RotationConfig | null>(null);
  const [resetSchedule, setResetSchedule] = useState<LeaderboardResetSchedule | null>(null);
  const [heatmapPoints, setHeatmapPoints] = useState<HeatmapPoint[]>([]);
  const [spawns, setSpawns] = useState<SpawnPoint[]>(propSpawns);
  const [rotation, setRotation] = useState<RotationState>(propRotation);

  const loadAdminData = useCallback(async () => {
    try {
      const [stats, config, sched, heat, currentSpawns, currentRot] = await Promise.all([
        gameService.getAdminOverviewStats(),
        gameService.getRotationConfig(),
        gameService.getResetSchedule(),
        gameService.getHeatmapData(),
        gameService.getSpawns(),
        gameService.getActiveRotation(),
      ]);

      setOverviewStats(stats);
      setRotationConfig(config);
      setResetSchedule(sched);
      setHeatmapPoints(heat);
      setSpawns(currentSpawns);
      setRotation(currentRot);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  // Handle Spawn Enabled/Disabled Toggle (A2)
  const handleToggleSpawn = async (id: string, enabled: boolean) => {
    try {
      await gameService.toggleSpawnStatus(id, enabled);
      await loadAdminData();
      onRefreshSpawns?.();
      onShowToast?.({
        title: enabled ? 'Spawn Activated' : 'Spawn Disabled',
        message: `Spawn point is now ${enabled ? 'active' : 'disabled'}.`,
        type: 'info',
      });
    } catch (err) {
      onShowToast?.({
        title: 'Error',
        message: 'Could not toggle spawn point.',
        type: 'error',
      });
    }
  };

  // Handle Edit Spawn Point (A2)
  const handleSaveSpawn = async (spawn: SpawnPoint) => {
    try {
      await gameService.saveSpawnPoint(spawn);
      await loadAdminData();
      onRefreshSpawns?.();
      onShowToast?.({
        title: 'Spawn Saved',
        message: `Updated configuration for ${spawn.code}.`,
        type: 'success',
      });
    } catch (err) {
      onShowToast?.({
        title: 'Save Failed',
        message: 'Could not save spawn point changes.',
        type: 'error',
      });
    }
  };

  // Handle Create New Spawn Point (A2)
  const handleCreateSpawn = async (spawnData: Omit<SpawnPoint, 'id'>) => {
    try {
      const created = await gameService.createSpawnPoint(spawnData);
      await loadAdminData();
      onRefreshSpawns?.();
      onShowToast?.({
        title: 'Spawn Point Created',
        message: `Added ${created.title} (${created.code}) to campus pool.`,
        type: 'success',
      });
    } catch (err) {
      onShowToast?.({
        title: 'Create Failed',
        message: 'Could not create new spawn point.',
        type: 'error',
      });
    }
  };

  // Handle Delete Spawn Point (A2)
  const handleDeleteSpawn = async (id: string) => {
    try {
      await gameService.deleteSpawnPoint(id);
      await loadAdminData();
      onRefreshSpawns?.();
      onShowToast?.({
        title: 'Spawn Deleted',
        message: 'Removed spawn point from pool.',
        type: 'info',
      });
    } catch (err) {
      onShowToast?.({
        title: 'Delete Failed',
        message: 'Could not delete spawn point.',
        type: 'error',
      });
    }
  };

  // Handle Update Rotation Config (A3)
  const handleUpdateRotationConfig = async (configUpdate: Partial<RotationConfig>) => {
    try {
      const updated = await gameService.updateRotationConfig(configUpdate);
      setRotationConfig(updated);
      onShowToast?.({
        title: 'Rotation Settings Saved',
        message: `Interval: ${updated.intervalMinutes}m · Active: ${updated.concurrentActivePoints} points.`,
        type: 'success',
      });
    } catch (err) {
      onShowToast?.({
        title: 'Settings Error',
        message: 'Could not save rotation parameters.',
        type: 'error',
      });
    }
  };

  // Handle Force Rotate Now (A3)
  const handleForceRotate = async () => {
    try {
      const newRot = await gameService.forceRotateNow();
      await loadAdminData();
      onRefreshSpawns?.();
      onShowToast?.({
        title: `Rotation #${newRot.rotationNumber} Active`,
        message: `Rotated ${newRot.totalActiveSpawns} campus spawns instantly.`,
        type: 'success',
      });
    } catch (err) {
      onShowToast?.({
        title: 'Rotation Failed',
        message: 'Could not force rotation.',
        type: 'error',
      });
    }
  };

  // Handle Update Reset Schedule (A4)
  const handleUpdateSchedule = async (scheduleUpdate: Partial<LeaderboardResetSchedule>) => {
    try {
      const updated = await gameService.updateResetSchedule(scheduleUpdate);
      setResetSchedule(updated);
      onShowToast?.({
        title: 'Reset Schedule Saved',
        message: `Scheduled for every ${updated.resetDay} at ${updated.resetTime}.`,
        type: 'success',
      });
    } catch (err) {
      onShowToast?.({
        title: 'Schedule Error',
        message: 'Could not update reset schedule.',
        type: 'error',
      });
    }
  };

  // Handle Manual Reset of Weekly Leaderboard (A4)
  const handleResetWeeklyLeaderboard = async () => {
    try {
      const res = await gameService.resetWeeklyLeaderboard();
      await loadAdminData();
      onRefreshSpawns?.();
      onShowToast?.({
        title: 'Weekly Standings Reset',
        message: res.message,
        type: 'success',
      });
      return res;
    } catch (err) {
      onShowToast?.({
        title: 'Reset Failed',
        message: 'Could not reset leaderboard.',
        type: 'error',
      });
      throw err;
    }
  };

  if (loading || !overviewStats || !rotationConfig || !resetSchedule) {
    return (
      <div className="h-64 flex items-center justify-center">
        <LoadingState message="Connecting to I9 Admin Database..." />
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Tab A1 — DASHBOARD OVERVIEW */}
      {activeTab === 'overview' && (
        <AdminOverviewTab
          stats={overviewStats}
          rotationNumber={rotation.rotationNumber}
        />
      )}

      {/* Tab A2 — SPAWN POINT MANAGEMENT */}
      {activeTab === 'points' && (
        <AdminPointsTab
          spawns={spawns}
          zones={zones}
          onToggleSpawn={handleToggleSpawn}
          onSaveSpawn={handleSaveSpawn}
          onCreateSpawn={handleCreateSpawn}
          onDeleteSpawn={handleDeleteSpawn}
        />
      )}

      {/* Tab A3 — ROTATION SETTINGS */}
      {activeTab === 'rotate' && (
        <AdminRotateTab
          rotation={rotation}
          config={rotationConfig}
          onUpdateConfig={handleUpdateRotationConfig}
          onForceRotate={handleForceRotate}
        />
      )}

      {/* Tab A4 — LEADERBOARD RESET */}
      {activeTab === 'reset' && (
        <AdminResetTab
          schedule={resetSchedule}
          onUpdateSchedule={handleUpdateSchedule}
          onResetWeeklyLeaderboard={handleResetWeeklyLeaderboard}
        />
      )}

      {/* Tab A5 — ANALYTICS & HEATMAP */}
      {activeTab === 'stats' && (
        <AdminStatsTab
          heatmapPoints={heatmapPoints}
          zones={zones}
        />
      )}
    </div>
  );
};
