/**
 * @file VaultDrive — Application entry point.
 *
 * Design decisions:
 *
 * 1. Security headers (Helmet): Sets Content-Security-Policy, X-Frame-Options,
 *    X-Content-Type-Options, etc. Essential for any production API.
 *
 * 2. Rate limiting: 100 requests per 15 minutes per IP. Prevents abuse and
 *    protects downstream services (DB, Filebase) from being overwhelmed.
 *
 * 3. CORS: Configured to allow any origin in development. In production,
 *    this should be restricted to specific frontend domains.
 *
 * 4. Graceful shutdown: On SIGTERM/SIGINT, we close Prisma and Redis
 *    connections before exiting. This prevents connection leaks during
 *    deployments and container restarts.
 *
 * 5. Body size limit: Express JSON body parser is limited to 10MB. Larger
 *    payloads should use the chunked upload API.
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { serverConfig } from './config';
import v1Router from './routers/v1/index.router';
import v2Router from './routers/v2/index.router';
import { appErrorHandler, genericErrorHandler } from './middlewares/error.middleware';
import logger from './config/logger.config';
import { attachCorrelationIdMiddleware } from './middlewares/correlation.middleware';
import prisma from './config/prisma.config';
import redis from './config/redis.config';

const app = express();

// ─── Security ────────────────────────────────────────────────────────────────

app.use(helmet());

app.use(cors({
  origin: '*', // Restrict in production
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Rate Limiting ───────────────────────────────────────────────────────────

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // 100 requests per window per IP
  standardHeaders: true,     // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,      // Disable `X-RateLimit-*` headers
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

app.use(limiter);

// ─── Body Parsing ────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Request Tracing ─────────────────────────────────────────────────────────

app.use(attachCorrelationIdMiddleware);

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use('/api/v1', v1Router);
app.use('/api/v2', v2Router);

// ─── Error Handling ──────────────────────────────────────────────────────────

app.use(appErrorHandler);
app.use(genericErrorHandler);

// ─── Server Start ────────────────────────────────────────────────────────────

const server = app.listen(serverConfig.PORT, () => {
  logger.info(`🚀 VaultDrive is running on http://localhost:${serverConfig.PORT}`);
  logger.info(`📚 API base: http://localhost:${serverConfig.PORT}/api/v1`);
  logger.info(`Press Ctrl+C to stop the server.`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
// Close database and cache connections before the process exits.
// This prevents connection leaks during container restarts and deployments.

async function shutdown(signal: string) {
  logger.info(`${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await prisma.$disconnect();
      logger.info('Prisma disconnected');
    } catch (err) {
      logger.error('Error disconnecting Prisma', { error: err });
    }

    try {
      redis.disconnect();
      logger.info('Redis disconnected');
    } catch (err) {
      logger.error('Error disconnecting Redis', { error: err });
    }

    process.exit(0);
  });

  // Force shutdown after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
