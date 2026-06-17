/**
 * @file Prisma client singleton.
 *
 * Design decision: Prisma 7 requires a driver adapter instead of a direct
 * connection URL. We use @prisma/adapter-pg with the `pg` Pool driver.
 * The Pool provides built-in connection pooling — critical for production
 * workloads where many concurrent requests share a limited number of
 * database connections.
 *
 * A single PrismaClient instance is shared across all repositories.
 */

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { serverConfig } from './index';

// Connection pool — Prisma 7 uses this under the hood for all queries
const pool = new Pool({
  connectionString: serverConfig.DATABASE_URL,
});

// Prisma 7 driver adapter for PostgreSQL
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export default prisma;

/**
 * Transaction client type — the type Prisma passes to $transaction callbacks.
 * This preserves all model delegates (file, chunk, etc.) while excluding
 * methods that can't be used inside transactions ($connect, $disconnect, etc.).
 */
export type PrismaTxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
