import dotenv from 'dotenv';
import { AppConfig, validateEnvironment } from './env';

// Load .env file into process.env if present
dotenv.config();

const validation = validateEnvironment(process.env);

if (!validation.valid || !validation.config) {
  console.error('[I9 Server Bootstrap] FATAL: Invalid configuration:');
  validation.errors.forEach((err) => console.error(`  - ${err}`));
  throw new Error(`[I9 Server Bootstrap] Environment validation failed:\n${validation.errors.join('\n')}`);
}

export const config: AppConfig = validation.config;
export * from './env';
