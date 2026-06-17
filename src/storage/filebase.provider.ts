/**
 * @file Filebase storage provider implementation.
 *
 * Design decisions:
 *
 * 1. Uses AWS SDK v3 commands (PutObject, GetObject, DeleteObject, HeadObject)
 *    because Filebase is fully S3-compatible.
 *
 * 2. Downloads return a Node.js Readable stream rather than buffering the
 *    entire object in memory. This is critical for large files — a 1 GB file
 *    should not consume 1 GB of RAM on the server.
 *
 * 3. The `exists` check uses HeadObject (metadata-only request) instead of
 *    GetObject, avoiding unnecessary data transfer.
 *
 * 4. All operations log at debug/error level for observability without
 *    being noisy in production.
 */

import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { StorageProvider } from '../types/index';
import { s3Client, BUCKET_NAME } from '../config/storage.config';
import logger from '../config/logger.config';

export class FilebaseStorageProvider implements StorageProvider {
  /**
   * Upload binary content to Filebase.
   *
   * The key should be content-addressable for chunks (e.g., "chunks/<sha256>")
   * or unique for other objects. Filebase stores the object immutably — the
   * same key always returns the same content (IPFS-backed).
   */
  async upload(key: string, buffer: Buffer): Promise<string> {
    logger.info('Storage: uploading object', { key, size: buffer.length });

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
      })
    );

    logger.info('Storage: upload complete', { key });
    return key;
  }

  /**
   * Download an object as a readable stream.
   *
   * The AWS SDK v3 returns the Body as a Readable stream (in Node.js),
   * which we pipe directly to the HTTP response — no intermediate buffering.
   */
  async download(key: string): Promise<Readable> {
    logger.info('Storage: downloading object', { key });

    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    );

    // AWS SDK v3 returns Body as a web ReadableStream in Node.js
    // We need to cast it to a Node.js Readable
    if (!response.Body) {
      throw new Error(`Storage: empty body for key ${key}`);
    }

    return response.Body as Readable;
  }

  /**
   * Delete an object permanently.
   *
   * Called during garbage collection when a chunk's reference count drops
   * to zero — meaning no FileVersion references it anymore.
   */
  async delete(key: string): Promise<void> {
    logger.info('Storage: deleting object', { key });

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    );

    logger.info('Storage: delete complete', { key });
  }

  /**
   * Check if an object exists without downloading it.
   *
   * Uses HEAD request — returns only metadata (size, content-type, etc.),
   * not the actual object content. This is the cheapest way to verify
   * existence and is used during deduplication checks.
   */
  async exists(key: string): Promise<boolean> {
    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        })
      );
      return true;
    } catch (error: unknown) {
      // HeadObject throws NotFound (404) if the object doesn't exist
      if (error instanceof Error && error.name === 'NotFound') {
        return false;
      }
      // Re-throw unexpected errors (permissions, network, etc.)
      throw error;
    }
  }
}
