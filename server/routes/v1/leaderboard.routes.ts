import { Router } from 'express';
import { LeaderboardController } from '../../controllers/LeaderboardController';

export function createLeaderboardRouter(leaderboardController: LeaderboardController): Router {
  const router = Router();

  // GET /api/v1/leaderboard/weekly
  router.get('/weekly', leaderboardController.getWeeklyLeaderboard);

  // GET /api/v1/leaderboard/all-time
  router.get('/all-time', leaderboardController.getAllTimeLeaderboard);

  // GET /api/v1/leaderboard/rank/weekly/:playerId and GET /api/v1/leaderboard/rank/weekly?playerId=...
  router.get('/rank/weekly/:playerId', leaderboardController.getPlayerWeeklyRank);
  router.get('/rank/weekly', leaderboardController.getPlayerWeeklyRank);

  // GET /api/v1/leaderboard/rank/all-time/:playerId and GET /api/v1/leaderboard/rank/all-time?playerId=...
  router.get('/rank/all-time/:playerId', leaderboardController.getPlayerAllTimeRank);
  router.get('/rank/all-time', leaderboardController.getPlayerAllTimeRank);

  // GET /api/v1/leaderboard/rank/:playerId and GET /api/v1/leaderboard/rank?playerId=...
  router.get('/rank/:playerId', leaderboardController.getPlayerRank);
  router.get('/rank', leaderboardController.getPlayerRank);

  return router;
}
