import { Router } from 'express';
import { WeeklyCycleController } from '../../controllers/WeeklyCycleController';

export function createWeeklyCycleRouter(weeklyCycleController: WeeklyCycleController): Router {
  const router = Router();

  // GET /api/v1/weekly-cycle/next-reset
  router.get('/next-reset', weeklyCycleController.getNextReset);

  // GET /api/v1/weekly-cycle (alias to next-reset)
  router.get('/', weeklyCycleController.getNextReset);

  return router;
}
