import https from 'https';
import crypto from 'crypto';

export interface GoogleTokenPayload {
  iss: string;
  sub: string;
  azp?: string;
  aud: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  hd?: string;
  iat: number;
  exp: number;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  id_token: string;
  scope: string;
  token_type: string;
  refresh_token?: string;
}

interface JwkKey {
  kty: string;
  alg: string;
  use: string;
  kid: string;
  n: string;
  e: string;
}

interface JwksResponse {
  keys: JwkKey[];
}

export class GoogleOidcClient {
  private static cachedJwks: JwksResponse | null = null;
  private static jwksCachedAt = 0;
  private static readonly JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly callbackUrl: string
  ) {}

  /**
   * Generates Google OAuth 2.0 Authorization URL with PKCE and state protection.
   */
  public generateAuthUrl(state: string, codeChallenge: string, collegeDomainHint?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'select_account',
    });

    if (collegeDomainHint) {
      params.set('hd', collegeDomainHint);
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchanges authorization code for Google tokens.
   */
  public async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<GoogleTokenResponse> {
    const postData = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.callbackUrl,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }).toString();

    return new Promise((resolve, reject) => {
      const req = https.request(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(data.error_description || data.error || 'Failed to exchange authorization code'));
              } else {
                resolve(data as GoogleTokenResponse);
              }
            } catch (e) {
              reject(new Error(`Failed to parse Google token response: ${(e as Error).message}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.write(postData);
      req.end();
    });
  }

  /**
   * Fetches Google JWKS certificates for signature validation.
   */
  public async getJwks(): Promise<JwksResponse> {
    const now = Date.now();
    if (GoogleOidcClient.cachedJwks && now - GoogleOidcClient.jwksCachedAt < GoogleOidcClient.JWKS_CACHE_TTL_MS) {
      return GoogleOidcClient.cachedJwks;
    }

    return new Promise((resolve, reject) => {
      https
        .get('https://www.googleapis.com/oauth2/v3/certs', (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              const jwks = JSON.parse(body) as JwksResponse;
              GoogleOidcClient.cachedJwks = jwks;
              GoogleOidcClient.jwksCachedAt = Date.now();
              resolve(jwks);
            } catch (err) {
              reject(err);
            }
          });
        })
        .on('error', reject);
    });
  }

  /**
   * Verifies a Google ID token server-side:
   * - Signature validated against Google's public JWKS certificates
   * - Issuer verification ('https://accounts.google.com' or 'accounts.google.com')
   * - Audience verification (matches configured GOOGLE_CLIENT_ID)
   * - Expiration check
   */
  public async verifyIdToken(idToken: string): Promise<GoogleTokenPayload> {
    if (!idToken || typeof idToken !== 'string') {
      throw new Error('Invalid ID token');
    }

    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid ID token format');
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    let header: any;
    let payload: GoogleTokenPayload;

    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as GoogleTokenPayload;
    } catch {
      throw new Error('Failed to parse ID token JSON');
    }

    // 0. Verify Header Algorithm & Key ID
    if (header.alg !== 'RS256') {
      throw new Error(`Unsupported token algorithm: ${header.alg}`);
    }
    if (!header.kid || typeof header.kid !== 'string') {
      throw new Error('Missing or invalid key ID (kid) in token header');
    }

    // 1. Verify Issuer
    const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
    if (!validIssuers.includes(payload.iss)) {
      throw new Error(`Invalid token issuer: ${payload.iss}`);
    }

    // 2. Verify Audience
    if (payload.aud !== this.clientId) {
      throw new Error(`Invalid token audience: expected ${this.clientId}, received ${payload.aud}`);
    }

    // 3. Verify Expiration
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      throw new Error('Google ID token has expired');
    }

    // 4. Verify Signature against Google JWKS (only allow mock bypass in test environment)
    const isMockInTest = process.env.NODE_ENV === 'test' && this.clientId.startsWith('mock-');
    if (!isMockInTest) {
      let jwks = await this.getJwks();
      let key = jwks.keys.find((k) => k.kid === header.kid);
      if (!key) {
        // Invalidate cache and fetch fresh JWKS once to accommodate recent key rotation
        GoogleOidcClient.cachedJwks = null;
        jwks = await this.getJwks();
        key = jwks.keys.find((k) => k.kid === header.kid);
      }
      if (!key) {
        throw new Error(`Public key with kid "${header.kid}" not found in Google JWKS`);
      }

      // Construct PEM and verify RSA-SHA256 signature
      const pem = this.rsaPublicKeyToPem(key.n, key.e);
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${headerB64}.${payloadB64}`);
      const isValid = verifier.verify(pem, Buffer.from(signatureB64, 'base64url'));
      if (!isValid) {
        throw new Error('Invalid ID token signature');
      }
    }

    return payload;
  }

  private rsaPublicKeyToPem(modulusB64: string, exponentB64: string): string {
    const modulus = Buffer.from(modulusB64, 'base64url');
    const exponent = Buffer.from(exponentB64, 'base64url');

    const keyObject = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: modulusB64,
        e: exponentB64,
      },
      format: 'jwk',
    });

    return keyObject.export({ type: 'spki', format: 'pem' }) as string;
  }
}
