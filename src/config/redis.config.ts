/**
 * @file Redis client singleton.
 *
 * Design decision: We use ioredis over the official `redis` package because
 * ioredis provides automatic reconnection, Lua scripting support, and
 * built-in cluster/sentinel support — features critical for production
 * caching and session management.
 *
 * The client is created once and exported as a singleton. All services
 * import from this module to avoid creating multiple connections.
 */

import Redis from 'ioredis';
import { serverConfig } from './index';
import logger from './logger.config';

const redis = new Redis(serverConfig.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    // Exponential backoff capped at 5 seconds
    const delay = Math.min(times * 200, 5000);
    logger.warn(`Redis reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('✅ Redis connected');
});

redis.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});

export default redis;
