import { Router } from 'express';
import { ClaimController } from '../../controllers/ClaimController';
import { validateRequest } from '../../validation/validateRequest';
import { ClaimSubmissionSchema } from '../../validation/schemas';
import { requireCurrentUser, createOptionalAuthMiddleware } from '../../middlewares/auth';

export function createClaimsRouter(claimController: ClaimController): Router {
  const router = Router();

  // POST /api/v1/claims - requires authentication
  router.post(
    '/',
    requireCurrentUser,
    validateRequest(ClaimSubmissionSchema, 'body'),
    claimController.submitClaim
  );

  // GET /api/v1/claims/history
  router.get('/history', createOptionalAuthMiddleware(), claimController.getPlayerClaimsHistory);

  return router;
}
