import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JwtUtils, verifyToken } from '../middlewares/auth';
import { config } from '../config';

describe('JWT Authentication Utilities & Programmatic Token Verification', () => {
  const sampleSecret = config.JWT_SECRET || 'super-secret-key-that-is-at-least-32-chars-long';

  it('should successfully sign and verify a token programmatically with verifyToken', () => {
    const token = JwtUtils.sign(
      {
        sub: 'usr_ws_12345',
        email: 'ws_user@campus.edu',
        username: 'socket_runner',
        role: 'STUDENT',
      },
      sampleSecret,
      3600
    );

    const user = verifyToken(token, sampleSecret);

    assert.equal(user.id, 'usr_ws_12345');
    assert.equal(user.email, 'ws_user@campus.edu');
    assert.equal(user.username, 'socket_runner');
    assert.equal(user.role, 'STUDENT');
  });

  it('should throw an error when token signature is tampered', () => {
    const token = JwtUtils.sign(
      {
        sub: 'usr_ws_12345',
        email: 'ws_user@campus.edu',
        username: 'socket_runner',
        role: 'STUDENT',
      },
      sampleSecret,
      3600
    );

    const tampered = token.slice(0, -4) + 'abcd';

    assert.throws(() => {
      verifyToken(tampered, sampleSecret);
    }, /Invalid token signature/);
  });

  it('should throw an expired error when token is past expiration', () => {
    const expiredToken = JwtUtils.sign(
      {
        sub: 'usr_ws_expired',
        email: 'expired@campus.edu',
        username: 'expired_runner',
        role: 'STUDENT',
      },
      sampleSecret,
      -10 // expired 10 seconds ago
    );

    assert.throws(() => {
      verifyToken(expiredToken, sampleSecret);
    }, /Token has expired/);
  });

  it('should reject invalid or malformed tokens', () => {
    assert.throws(() => {
      verifyToken('not-a-jwt', sampleSecret);
    }, /Invalid token structure/);

    assert.throws(() => {
      verifyToken('', sampleSecret);
    }, /Token must be a non-empty string/);
  });
});
