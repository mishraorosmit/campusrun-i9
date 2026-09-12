import crypto from 'crypto';

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: string;
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
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token structure');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    // Constant-time buffer comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(expectedSignature);
    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
      throw new Error('Invalid token signature');
    }

    const payloadJson = this.base64UrlDecode(encodedPayload);
    const payload = JSON.parse(payloadJson) as JwtPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      const err = new Error('Token has expired');
      (err as any).expired = true;
      throw err;
    }

    return payload;
  }
}
