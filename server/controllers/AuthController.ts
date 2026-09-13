import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/AuthService';
import { UnauthorizedError } from '../errors';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * GET /api/v1/auth/google
   * Initiates Google OAuth Authorization Code flow.
   */
  public initiateGoogleLogin = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const { url } = this.authService.initiateGoogleLogin();
      res.redirect(url);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/auth/google/url
   * Returns OAuth authorization URL and state as JSON (for SPA client redirects).
   */
  public getGoogleAuthUrl = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const authData = this.authService.initiateGoogleLogin();
      res.json({
        url: authData.url,
        state: authData.state,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/auth/google/callback
   * OAuth 2.0 redirect receiver. Exchanges code and state for tokens.
   */
  public handleGoogleCallback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.query.error) {
        throw new UnauthorizedError(`Google authentication cancelled or denied: ${req.query.error}`);
      }

      const code = req.query.code as string;
      const state = req.query.state as string;

      if (!code || !state) {
        throw new UnauthorizedError('Missing code or state parameter in OAuth callback');
      }

      const tokens = await this.authService.handleGoogleCallback(code, state);

      // Set refresh token in HttpOnly secure cookie
      this.setRefreshTokenCookie(res, tokens.refreshToken, tokens.expiresIn);

      res.json({
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user: tokens.user,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/auth/google/verify-token
   * Verifies Google One Tap or GIS client-side ID Token.
   */
  public verifyGoogleIdToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { idToken } = req.body;
      if (!idToken) {
        throw new UnauthorizedError('Missing idToken in request body');
      }

      const tokens = await this.authService.verifyGoogleIdToken(idToken);

      // Set refresh token in HttpOnly secure cookie
      this.setRefreshTokenCookie(res, tokens.refreshToken, tokens.expiresIn);

      res.json({
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user: tokens.user,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/auth/refresh
   * Exchanges a valid refresh token cookie for a new access token.
   */
  public refreshSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Extract from cookie or request body
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

      if (!refreshToken) {
        throw new UnauthorizedError('Missing refresh token');
      }

      const tokens = await this.authService.refreshSession(refreshToken);

      this.setRefreshTokenCookie(res, tokens.refreshToken, tokens.expiresIn);

      res.json({
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user: tokens.user,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/auth/logout
   * Revokes refresh session and clears auth cookies.
   */
  public logout = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
      if (refreshToken) {
        this.authService.revokeSession(refreshToken);
      }

      res.clearCookie('refreshToken', {
        path: '/api/v1/auth',
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
      });

      res.json({ message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/auth/me
   * Returns current authenticated user information from req.user.
   */
  public getMe = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Not authenticated'));
      return;
    }

    res.json({ user: req.user });
  };

  /**
   * POST /api/v1/auth/dev-login
   * Issues JWT token for development and local testing.
   */
  public devLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedError('Dev login is disabled in production environment');
      }

      const role = (req.body?.role || 'STUDENT').toUpperCase() === 'ADMIN' ? 'ADMIN' : 'STUDENT';
      const email = req.body?.email || (role === 'ADMIN' ? 'admin@campus.edu' : 'student@campus.edu');

      const tokens = await this.authService.createDevSession(email, role);
      this.setRefreshTokenCookie(res, tokens.refreshToken, tokens.expiresIn);

      res.json({
        success: true,
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user: tokens.user,
      });
    } catch (err) {
      next(err);
    }
  };

  private setRefreshTokenCookie(res: Response, refreshToken: string, maxAgeSeconds: number): void {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: maxAgeSeconds * 1000,
    });
  }
}
