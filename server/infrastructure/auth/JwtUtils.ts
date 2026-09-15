import crypto from 'crypto';
import { PlayerRole } from '../../domain/types';

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: PlayerRole;
  iat?: number;
  exp?: number;
}

/**
 * Clean, lightweight, dependency-free HMAC-SHA256 JWT utility
 */
export class JwtUtils {
  private static base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  private static base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  public static sign(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, expiresInSeconds: number): string {
    if (!secret || typeof secret !== 'string' || secret.length < 16) {
      throw new Error('JWT secret must be a non-empty string with adequate entropy');
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const fullPayload: JwtPayload = {
      ...payload,
      iat: now,
      exp: now + expiresInSeconds,
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(fullPayload));
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  public static verify(token: string, secret: string): JwtPayload {
    if (!secret || typeof secret !== 'string') {
      throw new Error('JWT secret must be provided for verification');
    }

    if (!token || typeof token !== 'string') {
      throw new Error('Token must be a non-empty string');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token structure');
    }

    const [encodedHeader, encodedPayload, signature] = parts;

    // 1. Decode and strictly validate header algorithm & type
    let header: any;
    try {
      header = JSON.parse(this.base64UrlDecode(encodedHeader));
    } catch {
      throw new Error('Invalid token header format');
    }

    if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') {
      throw new Error('Invalid or unsupported token algorithm or type');
    }

    // 2. Constant-time buffer comparison to prevent timing attacks
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(expectedSignature);
    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
      throw new Error('Invalid token signature');
    }

    // 3. Decode and validate payload
    let payload: JwtPayload;
    try {
      payload = JSON.parse(this.base64UrlDecode(encodedPayload)) as JwtPayload;
    } catch {
      throw new Error('Invalid token payload format');
    }

    if (!payload || !payload.sub || !payload.email || typeof payload.exp !== 'number') {
      throw new Error('Malformed token payload');
    }

    const now = Math.floor(Date.now() / 1000);
    // Reject tokens issued in the future (allowing 60s max clock drift)
    if (payload.iat && payload.iat > now + 60) {
      throw new Error('Token issued in the future');
    }

    if (payload.exp < now) {
      const err = new Error('Token has expired');
      (err as any).expired = true;
      throw err;
    }

    return payload;
  }
}
