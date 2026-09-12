import { Router } from 'express';
import { AuthController } from '../../controllers/AuthController';
import { requireAuthenticatedUser } from '../../middlewares/auth';

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  // 1. Google OAuth2 Authorization Code Initiation
  router.get('/google', controller.initiateGoogleLogin);
  router.get('/google/url', controller.getGoogleAuthUrl);

  // 2. Google OAuth2 Callback Receiver
  router.get('/google/callback', controller.handleGoogleCallback);

  // 3. Direct Google One Tap / GIS ID Token Verification
  router.post('/google/verify-token', controller.verifyGoogleIdToken);

  // 4. Session Token Refresh
  router.post('/refresh', controller.refreshSession);

  // 5. Session Logout
  router.post('/logout', controller.logout);

  // 6. Current Authenticated Player Identity / Session Endpoint
  router.get('/session', requireAuthenticatedUser, controller.getMe);
  router.get('/me', requireAuthenticatedUser, controller.getMe);

  return router;
}
