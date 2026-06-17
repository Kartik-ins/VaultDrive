/**
 * @file VaultDrive — Environment configuration with validation.
 *
 * Design decision: We use Zod to validate environment variables at startup.
 * This provides fail-fast behavior — if a required variable is missing or
 * malformed, the process exits immediately with a clear error message,
 * rather than failing at an unpredictable point during runtime.
 */

import dotenv from 'dotenv';
import { z } from 'zod';
import logger from './logger.config';

dotenv.config();

// ─── Environment schema ─────────────────────────────────────────────────────
// Every env var the application needs is declared here with its type and
// default value (if any). Adding a new config value is a single-line change.

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  FILEBASE_ACCESS_KEY: z.string().min(1, 'FILEBASE_ACCESS_KEY is required'),
  FILEBASE_SECRET_KEY: z.string().min(1, 'FILEBASE_SECRET_KEY is required'),
  FILEBASE_BUCKET: z.string().min(1, 'FILEBASE_BUCKET is required'),
  CHUNK_SIZE_BYTES: z.coerce.number().default(5_242_880), // 5 MB
});

// Parse and validate — throws with descriptive errors on failure
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  logger.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    logger.error(`  → ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const serverConfig = parsed.data;