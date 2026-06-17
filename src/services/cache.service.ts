/**
 * @file Cache service — high-performance Redis operations.
 *
 * Design decisions:
 *
 * 1. Safe failures: If Redis is unavailable or errors, the cache service
 *    logs the error and returns null/void. The application falls back gracefully
 *    to the database, ensuring zero downtime even during Redis outages.
 *
 * 2. Serialization: All values are serialized to JSON before storage,
 *    and parsed back to their original types on retrieval.
 *
 * 3. SCAN for invalidation: `KEYS` is a blocking command that can degrade Redis
 *    performance in production. We use `SCAN` with a cursor to incrementally
 *    find and delete keys matching a pattern.
 */

import redis from '../config/redis.config';
import logger from '../config/logger.config';

export class CacheService {
  /**
   * Get data from cache. Parses JSON string back to the generic type T.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await redis.get(key);
      if (!value) {
        return null;
      }
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error('CacheService: failed to get key', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Store data in cache. Serializes the value to JSON.
   * Accepts an optional TTL (Time to Live) in seconds.
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds !== undefined && ttlSeconds > 0) {
        await redis.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await redis.set(key, serialized);
      }
    } catch (error) {
      logger.error('CacheService: failed to set key', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Delete a key from cache.
   */
  async del(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      logger.error('CacheService: failed to delete key', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Invalidate multiple keys matching a pattern.
   * Uses SCAN to find keys incrementally, avoiding blocking Redis threads.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
          logger.info('CacheService: invalidated keys matching pattern', {
            pattern,
            keysCount: keys.length,
          });
        }
      } while (cursor !== '0');
    } catch (error) {
      logger.error('CacheService: failed to invalidate pattern', {
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const cacheService = new CacheService();
export default cacheService;
