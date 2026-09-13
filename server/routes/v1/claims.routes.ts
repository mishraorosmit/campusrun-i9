import { Router, Request, Response, NextFunction } from 'express';
import { ClaimController } from '../../controllers/ClaimController';
import { validateRequest } from '../../validation/validateRequest';
import { ClaimSubmissionSchema } from '../../validation/schemas';
import { requireAuthenticatedUser } from '../../middlewares/auth';

function normalizeCoordinates(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    if (req.body.latitude === undefined && req.body.lat !== undefined) {
      req.body.latitude = req.body.lat;
    }
    if (req.body.longitude === undefined && req.body.lng !== undefined) {
      req.body.longitude = req.body.lng;
    }
  }
  next();
}

export function createClaimsRouter(claimController: ClaimController): Router {
  const router = Router();

  // POST /api/v1/claims - Strictly requires authentication, validates coordinates, executes server-side validation
  router.post(
    '/',
    requireAuthenticatedUser,
    normalizeCoordinates,
    validateRequest(ClaimSubmissionSchema, 'body'),
    claimController.submitClaim
  );

  // GET /api/v1/claims/history
  router.get('/history', requireAuthenticatedUser, claimController.getPlayerClaimsHistory);

  return router;
}
