import { Router } from 'express';
import { ClaimController } from '../../controllers/ClaimController';
import { validateRequest } from '../../validation/validateRequest';
import { ClaimSubmissionSchema } from '../../validation/schemas';

export function createClaimsRouter(claimController: ClaimController): Router {
  const router = Router();

  // POST /api/v1/claims
  router.post('/', validateRequest(ClaimSubmissionSchema, 'body'), claimController.submitClaim);

  // GET /api/v1/claims/history
  router.get('/history', claimController.getPlayerClaimsHistory);

  return router;
}
