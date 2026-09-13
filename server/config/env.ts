/**
 * Application Configuration Schema & Validation
 * Validates environment variables at application startup (fail-fast guarantee).
 */

export interface AppConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  API_PREFIX: string;
  APP_URL: string;
  CORS_ORIGIN: string;

  // Database & Connection Pooling
  DATABASE_URL: string;
  DB_POOL_MIN: number;
  DB_POOL_MAX: number;
  DB_IDLE_TIMEOUT_MS: number;
  DB_CONNECT_TIMEOUT_MS: number;
  DB_STATEMENT_TIMEOUT_MS: number;

  // Game Parameters
  ROTATION_INTERVAL_MINUTES: number;
  MIN_SPAWN_DISTANCE_METERS: number;
  CLAIM_RADIUS_METERS: number;
  CONCURRENT_ACTIVE_SPAWNS: number;
  STREAK_GRACE_HOURS: number;

  // Authentication & Google OAuth
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_CALLBACK_URL: string;
  AUTH_COLLEGE_DOMAIN: string;
  JWT_SECRET: string;
  JWT_ACCESS_EXPIRATION_SECONDS: number;
  REFRESH_TOKEN_EXPIRATION_SECONDS: number;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  config?: AppConfig;
}

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): ValidationResult {
  const errors: string[] = [];

  // NODE_ENV
  const nodeEnv = (env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    errors.push(`Invalid NODE_ENV: "${env.NODE_ENV}". Allowed: development, production, test`);
  }

  // PORT
  const portStr = env.PORT || '3001';
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT: "${portStr}". Must be an integer between 1 and 65535.`);
  }

  // API_PREFIX
  const apiPrefix = env.API_PREFIX || '/api/v1';
  if (!apiPrefix.startsWith('/')) {
    errors.push(`Invalid API_PREFIX: "${apiPrefix}". Must start with a forward slash "/".`);
  }

  // APP_URL
  const appUrl = env.APP_URL || 'http://localhost:3000';

  // CORS_ORIGIN (wildcard prohibited in production)
  const isProd = nodeEnv === 'production';
  let corsOrigin = env.CORS_ORIGIN;
  if (!corsOrigin) {
    corsOrigin = isProd ? 'https://campusrun.vercel.app' : '*';
  } else if (isProd && corsOrigin === '*') {
    corsOrigin = 'https://campusrun.vercel.app';
  }

  // Database Connection URL (Defaults to dedicated i9_app_user)
  const databaseUrl =
    env.DATABASE_URL || 'postgres://i9_app_user:i9_app_password@localhost:5432/campus_run';
  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    errors.push(`Invalid DATABASE_URL: must be a valid PostgreSQL connection URI.`);
  }

  // Connection Pool Parameters
  const poolMin = parseInt(env.DB_POOL_MIN || '2', 10);
  if (isNaN(poolMin) || poolMin < 0) {
    errors.push(`Invalid DB_POOL_MIN: "${env.DB_POOL_MIN}". Must be >= 0.`);
  }

  const poolMax = parseInt(env.DB_POOL_MAX || '20', 10);
  if (isNaN(poolMax) || poolMax <= 0 || poolMax < poolMin) {
    errors.push(`Invalid DB_POOL_MAX: "${env.DB_POOL_MAX}". Must be >= DB_POOL_MIN.`);
  }

  const idleTimeout = parseInt(env.DB_IDLE_TIMEOUT_MS || '30000', 10);
  if (isNaN(idleTimeout) || idleTimeout <= 0) {
    errors.push(`Invalid DB_IDLE_TIMEOUT_MS: "${env.DB_IDLE_TIMEOUT_MS}". Must be > 0.`);
  }

  const connectTimeout = parseInt(env.DB_CONNECT_TIMEOUT_MS || '5000', 10);
  if (isNaN(connectTimeout) || connectTimeout <= 0) {
    errors.push(`Invalid DB_CONNECT_TIMEOUT_MS: "${env.DB_CONNECT_TIMEOUT_MS}". Must be > 0.`);
  }

  const statementTimeout = parseInt(env.DB_STATEMENT_TIMEOUT_MS || '5000', 10);
  if (isNaN(statementTimeout) || statementTimeout <= 0) {
    errors.push(`Invalid DB_STATEMENT_TIMEOUT_MS: "${env.DB_STATEMENT_TIMEOUT_MS}". Must be > 0.`);
  }

  // Game parameters
  const rotationInterval = parseInt(env.ROTATION_INTERVAL_MINUTES || '45', 10);
  if (isNaN(rotationInterval) || rotationInterval <= 0) {
    errors.push(`Invalid ROTATION_INTERVAL_MINUTES: "${env.ROTATION_INTERVAL_MINUTES}". Must be > 0.`);
  }

  const minSpawnDistance = parseInt(env.MIN_SPAWN_DISTANCE_METERS || '60', 10);
  if (isNaN(minSpawnDistance) || minSpawnDistance <= 0) {
    errors.push(`Invalid MIN_SPAWN_DISTANCE_METERS: "${env.MIN_SPAWN_DISTANCE_METERS}". Must be > 0.`);
  }

  const claimRadius = parseInt(env.CLAIM_RADIUS_METERS || '25', 10);
  if (isNaN(claimRadius) || claimRadius <= 0) {
    errors.push(`Invalid CLAIM_RADIUS_METERS: "${env.CLAIM_RADIUS_METERS}". Must be > 0.`);
  }

  const concurrentSpawns = parseInt(env.CONCURRENT_ACTIVE_SPAWNS || '15', 10);
  if (isNaN(concurrentSpawns) || concurrentSpawns <= 0) {
    errors.push(`Invalid CONCURRENT_ACTIVE_SPAWNS: "${env.CONCURRENT_ACTIVE_SPAWNS}". Must be > 0.`);
  }

  const streakGraceHours = parseInt(env.STREAK_GRACE_HOURS || '24', 10);
  if (isNaN(streakGraceHours) || streakGraceHours <= 0) {
    errors.push(`Invalid STREAK_GRACE_HOURS: "${env.STREAK_GRACE_HOURS}". Must be > 0.`);
  }

  // Authentication & Google OAuth parameters
  const googleClientId = env.GOOGLE_CLIENT_ID || 'mock-google-client-id.apps.googleusercontent.com';
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET || 'mock-google-client-secret';
  const googleCallbackUrl = env.GOOGLE_CALLBACK_URL || `${appUrl}/api/v1/auth/google/callback`;
  const authCollegeDomain = (env.AUTH_COLLEGE_DOMAIN || 'campus.edu').toLowerCase().trim();

  if (!authCollegeDomain.includes('.') || authCollegeDomain.startsWith('.') || authCollegeDomain.endsWith('.')) {
    errors.push(`Invalid AUTH_COLLEGE_DOMAIN: "${authCollegeDomain}". Must be a valid domain (e.g. campus.edu).`);
  }

  const jwtSecret = env.JWT_SECRET || 'i9-development-fallback-secret-key-32chars!';
  if (nodeEnv === 'production' && jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long in production.');
  }

  const jwtAccessExpiration = parseInt(env.JWT_ACCESS_EXPIRATION_SECONDS || '900', 10);
  if (isNaN(jwtAccessExpiration) || jwtAccessExpiration <= 0) {
    errors.push(`Invalid JWT_ACCESS_EXPIRATION_SECONDS: "${env.JWT_ACCESS_EXPIRATION_SECONDS}". Must be > 0.`);
  }

  const refreshTokenExpiration = parseInt(env.REFRESH_TOKEN_EXPIRATION_SECONDS || '604800', 10);
  if (isNaN(refreshTokenExpiration) || refreshTokenExpiration <= 0) {
    errors.push(`Invalid REFRESH_TOKEN_EXPIRATION_SECONDS: "${env.REFRESH_TOKEN_EXPIRATION_SECONDS}". Must be > 0.`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    config: {
      NODE_ENV: nodeEnv,
      PORT: port,
      API_PREFIX: apiPrefix,
      APP_URL: appUrl,
      CORS_ORIGIN: corsOrigin,
      DATABASE_URL: databaseUrl,
      DB_POOL_MIN: poolMin,
      DB_POOL_MAX: poolMax,
      DB_IDLE_TIMEOUT_MS: idleTimeout,
      DB_CONNECT_TIMEOUT_MS: connectTimeout,
      DB_STATEMENT_TIMEOUT_MS: statementTimeout,
      ROTATION_INTERVAL_MINUTES: rotationInterval,
      MIN_SPAWN_DISTANCE_METERS: minSpawnDistance,
      CLAIM_RADIUS_METERS: claimRadius,
      CONCURRENT_ACTIVE_SPAWNS: concurrentSpawns,
      STREAK_GRACE_HOURS: streakGraceHours,
      GOOGLE_CLIENT_ID: googleClientId,
      GOOGLE_CLIENT_SECRET: googleClientSecret,
      GOOGLE_CALLBACK_URL: googleCallbackUrl,
      AUTH_COLLEGE_DOMAIN: authCollegeDomain,
      JWT_SECRET: jwtSecret,
      JWT_ACCESS_EXPIRATION_SECONDS: jwtAccessExpiration,
      REFRESH_TOKEN_EXPIRATION_SECONDS: refreshTokenExpiration,
    },
  };
}
