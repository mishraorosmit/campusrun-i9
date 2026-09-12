import { Router } from 'express';
import { LeaderboardController } from '../../controllers/LeaderboardController';

export function createLeaderboardRouter(leaderboardController: LeaderboardController): Router {
  const router = Router();

  // GET /api/v1/leaderboard/weekly
  router.get('/weekly', leaderboardController.getWeeklyLeaderboard);

  // GET /api/v1/leaderboard/all-time
  router.get('/all-time', leaderboardController.getAllTimeLeaderboard);

  return router;
}
