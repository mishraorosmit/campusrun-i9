import crypto from 'crypto';
import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { Player } from '../domain/entities/Player';
import { GoogleOidcClient, GoogleTokenPayload } from '../infrastructure/auth/GoogleOidcClient';
import { JwtUtils, JwtPayload } from '../infrastructure/auth/JwtUtils';
import { UnauthorizedError, ForbiddenError, AppError } from '../errors';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    username: string;
    role: 'STUDENT' | 'ADMIN';
  };
}

export interface AuthServiceConfig {
  collegeDomain: string;
  jwtSecret: string;
  jwtAccessExpirationSeconds: number;
  refreshTokenExpirationSeconds: number;
}

export class AuthService {
  // In-memory active refresh tokens store (token -> { userId, expiresAt })
  // In full persistence, this can be stored in the database or Redis
  private refreshTokens: Map<string, { userId: string; expiresAt: number }> = new Map();

  // Temporary store for OAuth PKCE state & verifier: state -> { codeVerifier, expiresAt }
  private oauthStates: Map<string, { codeVerifier: string; expiresAt: number }> = new Map();

  constructor(
    private readonly oidcClient: GoogleOidcClient,
    private readonly playerRepo: IPlayerRepository,
    private readonly config: AuthServiceConfig
  ) {}

  /**
   * Generates authorization URL, state parameter, and code challenge for PKCE flow.
   */
  public initiateGoogleLogin(): { url: string; state: string } {
    this.pruneExpired();

    const state = crypto.randomBytes(24).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // Store state with 10-minute expiry
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.oauthStates.set(state, { codeVerifier, expiresAt });

    const url = this.oidcClient.generateAuthUrl(state, codeChallenge, this.config.collegeDomain);
    return { url, state };
  }

  /**
   * Completes OAuth 2.0 Authorization Code flow.
   * Exchanges code with Google, verifies identity, validates college domain,
   * provisions user/profile, and returns tokens.
   */
  public async handleGoogleCallback(code: string, state: string): Promise<AuthTokens> {
    if (!code || !state) {
      throw new UnauthorizedError('Missing OAuth authorization code or state');
    }

    // 1. Verify and consume state (single-use)
    const storedState = this.oauthStates.get(state);
    if (!storedState) {
      throw new UnauthorizedError('Invalid or expired OAuth state parameter. Please restart login.');
    }
    this.oauthStates.delete(state);

    if (Date.now() > storedState.expiresAt) {
      throw new UnauthorizedError('OAuth state has expired. Please restart login.');
    }

    // 2. Exchange authorization code for tokens
    let tokens: any;
    try {
      tokens = await this.oidcClient.exchangeCodeForTokens(code, storedState.codeVerifier);
    } catch (err: any) {
      throw new UnauthorizedError('Failed to exchange authorization code with Google');
    }

    if (!tokens || !tokens.id_token) {
      throw new UnauthorizedError('Google did not return a valid identity token (id_token)');
    }

    // 3. Verify ID Token server-side
    let googlePayload: GoogleTokenPayload;
    try {
      googlePayload = await this.oidcClient.verifyIdToken(tokens.id_token);
    } catch (err: any) {
      throw new UnauthorizedError('Google identity token verification failed');
    }

    // 4. Authenticate or provision user
    return this.processVerifiedGoogleIdentity(googlePayload);
  }

  /**
   * Direct ID Token verification (for Google One Tap / GIS web client).
   */
  public async verifyGoogleIdToken(idToken: string): Promise<AuthTokens> {
    if (!idToken) {
      throw new UnauthorizedError('Missing Google ID token');
    }

    let googlePayload: GoogleTokenPayload;
    try {
      googlePayload = await this.oidcClient.verifyIdToken(idToken);
    } catch (err: any) {
      throw new UnauthorizedError('Google identity token verification failed');
    }

    return this.processVerifiedGoogleIdentity(googlePayload);
  }

  /**
   * Authoritative identity processing:
   * 1. Never trust client claims — extract strictly from verified Google payload.
   * 2. Verify email presence and verified status.
   * 3. Normalize email and validate exact college domain match.
   * 4. Idempotently retrieve or provision user + profile.
   * 5. Issue JWT and refresh token.
   */
  public async processVerifiedGoogleIdentity(payload: GoogleTokenPayload): Promise<AuthTokens> {
    // 1. Email identity presence check
    if (!payload.email || typeof payload.email !== 'string') {
      throw new UnauthorizedError('Google identity did not provide an email address');
    }

    // 2. Verified email check
    if (payload.email_verified !== true) {
      throw new UnauthorizedError('Google account email is not verified. Please verify your Google email first.');
    }

    // 3. Normalize email and domain
    const email = payload.email.toLowerCase().trim();
    const parts = email.split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new UnauthorizedError('Malformed email address in Google identity');
    }

    const [localPart, domain] = parts;
    const allowedDomain = this.config.collegeDomain.toLowerCase().trim();

    // 4. Strict College Domain Check
    if (domain !== allowedDomain) {
      throw new ForbiddenError(
        `Access restricted to official @${allowedDomain} institutional email accounts. Received: @${domain}`,
        { receivedDomain: domain, requiredDomain: allowedDomain }
      );
    }

    // 5. User & Profile Provisioning / Lookup
    let player = await this.playerRepo.findByEmail(email);

    if (!player) {
      // Provision new user and profile
      const username = await this.generateUniqueUsername(localPart);
      const newPlayer = new Player({
        id: crypto.randomUUID(),
        email,
        username,
        avatarUrl: payload.picture,
        displayName: payload.name,
        status: 'active',
        totalPoints: 0,
        seasonPoints: 0,
        rank: 0,
        tier: 'tier1',
        claimsCount: 0,
        currentStreakDays: 0,
        role: 'STUDENT',
        createdAt: new Date(),
        lastActiveAt: new Date(),
      } as any);

      await this.playerRepo.save(newPlayer);
      player = newPlayer;
    } else {
      // Inactive / Suspended check
      if (!player.isActive) {
        throw new ForbiddenError('User account is inactive or suspended. Please contact campus administrator.');
      }

      // Returning user - update last active timestamp & profile fields
      const updated = new Player({
        ...player.props,
        avatarUrl: player.props.avatarUrl || payload.picture,
        displayName: player.props.displayName || payload.name,
        lastActiveAt: new Date(),
      });
      await this.playerRepo.save(updated);
      player = updated;
    }

    // 6. Issue Access JWT & Refresh Token
    return this.createSessionTokens(player);
  }

  /**
   * Refreshes an expired access token using a valid refresh token.
   */
  public async refreshSession(refreshToken: string): Promise<AuthTokens> {
    if (!refreshToken) {
      throw new UnauthorizedError('Missing refresh token');
    }

    const session = this.refreshTokens.get(refreshToken);
    if (!session) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    if (Date.now() > session.expiresAt) {
      this.refreshTokens.delete(refreshToken);
      throw new UnauthorizedError('Refresh token has expired. Please log in again.');
    }

    const player = await this.playerRepo.findById(session.userId);
    if (!player || !player.isActive) {
      this.refreshTokens.delete(refreshToken);
      throw new UnauthorizedError('User account not found or inactive');
    }

    // Single-use token rotation: invalidate old refresh token
    this.refreshTokens.delete(refreshToken);

    // Issue fresh pair
    return this.createSessionTokens(player);
  }

  /**
   * Logs out user by revoking refresh token.
   */
  public revokeSession(refreshToken: string): void {
    if (refreshToken) {
      this.refreshTokens.delete(refreshToken);
    }
  }

  /**
   * Cleans up expired OAuth states and refresh tokens from memory.
   */
  private pruneExpired(): void {
    const now = Date.now();
    for (const [state, entry] of this.oauthStates.entries()) {
      if (now > entry.expiresAt) {
        this.oauthStates.delete(state);
      }
    }
    for (const [token, entry] of this.refreshTokens.entries()) {
      if (now > entry.expiresAt) {
        this.refreshTokens.delete(token);
      }
    }
  }

  private createSessionTokens(player: Player): AuthTokens {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: player.id,
      email: player.props.email,
      username: player.username,
      role: player.role,
    };

    const accessToken = JwtUtils.sign(payload, this.config.jwtSecret, this.config.jwtAccessExpirationSeconds);

    // Generate 256-bit cryptographically secure opaque refresh token
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.config.refreshTokenExpirationSeconds * 1000;
    this.refreshTokens.set(refreshToken, { userId: player.id, expiresAt });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.jwtAccessExpirationSeconds,
      user: {
        id: player.id,
        email: player.props.email,
        username: player.username,
        role: player.role,
      },
    };
  }

  /**
   * Generates a sanitized alphanumeric username handle with collision de-duplication.
   */
  private async generateUniqueUsername(localPart: string): Promise<string> {
    // Sanitize: lowercase alphanumeric and underscore only, 3-20 characters
    let base = localPart.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (base.length < 3) {
      base = `runner_${base}`;
    }
    if (base.length > 20) {
      base = base.substring(0, 20);
    }

    let candidate = base;
    let existing = await this.playerRepo.findByUsername(candidate);
    let attempts = 0;

    while (existing && attempts < 10) {
      const suffix = crypto.randomBytes(2).toString('hex'); // 4-char hex
      candidate = `${base.substring(0, 15)}_${suffix}`;
      existing = await this.playerRepo.findByUsername(candidate);
      attempts++;
    }

    return candidate;
  }
}
