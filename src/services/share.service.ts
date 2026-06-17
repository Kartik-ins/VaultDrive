/**
 * @file Share service — business logic for creating and accessing share links.
 *
 * Design decisions:
 *
 * 1. Cryptographically secure tokens: We use `crypto.randomBytes(32)` to generate
 *    64-character hex strings, preventing token guessing.
 *
 * 2. High-performance caching for unlimited links: If a share link does not
 *    have a download limit, we cache it in Redis (including its file versions
 *    and chunk mappings). Accessing the link bypasses the database entirely,
 *    except for a background call to increment the download count.
 *
 * 3. Strict consistency for limited links: If a link has a `maxDownloads` limit,
 *    we perform a synchronous DB update on access to ensure atomic compliance
 *    with the limit, preventing race conditions (multiple users downloading
 *    simultaneously past the limit).
 *
 * 4. Streaming reconstruction: Just like regular downloads, share downloads
 *    pipe chunk streams sequentially into a PassThrough stream to minimize
 *    memory usage on the server.
 */

import crypto from 'crypto';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { shareRepository } from '../repositories/share.repository';
import { fileRepository } from '../repositories/file.repository';
import { getStorageProvider } from '../storage/index';
import { cacheService } from './cache.service';
import { NotFoundError } from '../utils/errors/app.error';
import logger from '../config/logger.config';

export class ShareService {
  private storage = getStorageProvider();

  /**
   * Create a public share link for a file.
   * Verify ownership before generating the link.
   */
  async createShareLink(
    fileId: string,
    ownerId: string,
    data: { expiresAt?: Date; maxDownloads?: number },
    protocol: string,
    host: string
  ) {
    // 1. Verify file exists and belongs to the caller
    const file = await fileRepository.findByIdAndOwner(fileId, ownerId);
    if (!file) {
      throw new NotFoundError('File not found');
    }

    // 2. Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

    // 3. Create link in database
    const shareLink = await shareRepository.create({
      fileId,
      token,
      expiresAt: data.expiresAt,
      maxDownloads: data.maxDownloads,
    });

    // 4. Construct download URL
    const downloadUrl = `${protocol}://${host}/api/v1/share/${token}`;

    logger.info('ShareService: share link created', {
      fileId,
      tokenId: shareLink.id,
      expiresAt: data.expiresAt,
      maxDownloads: data.maxDownloads,
    });

    return {
      id: shareLink.id,
      fileId: shareLink.fileId,
      token: shareLink.token,
      downloadUrl,
      expiresAt: shareLink.expiresAt,
      maxDownloads: shareLink.maxDownloads,
      downloadCount: shareLink.downloadCount,
      createdAt: shareLink.createdAt,
    };
  }

  /**
   * Access a share link by token. Validates rules and returns a readable stream.
   */
  async accessShareLink(token: string) {
    const cacheKey = `vaultdrive:share:${token}`;
    let shareLink = await cacheService.get<any>(cacheKey);
    let cacheHit = false;

    if (shareLink) {
      cacheHit = true;
      logger.info('ShareService: cache hit for share link token', { token: token.substring(0, 8) });
    } else {
      logger.info('ShareService: cache miss for share link token', { token: token.substring(0, 8) });
      shareLink = await shareRepository.findByToken(token);
    }

    // 1. Check existence
    if (!shareLink || !shareLink.file) {
      throw new NotFoundError('Share link not found or invalid');
    }

    // 2. Check expiration
    if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
      logger.info('ShareService: share link expired', { tokenId: shareLink.id });
      // Cleanup expired links asynchronously
      await shareRepository.delete(shareLink.id).catch((err) =>
        logger.error('ShareService: failed to delete expired link from DB', { error: err.message })
      );
      await cacheService.del(cacheKey);
      throw new NotFoundError('Share link not found or invalid'); // Mask as not found
    }

    // 3. Check download limit
    if (shareLink.maxDownloads !== null && shareLink.maxDownloads !== undefined) {
      // Synchronous atomic database increment to prevent concurrent limit bypasses
      const updatedLink = await shareRepository.incrementDownloadCount(shareLink.id);
      
      if (updatedLink.downloadCount > (shareLink.maxDownloads as number)) {
        logger.info('ShareService: share link download limit reached', { tokenId: shareLink.id });
        // Cleanup limit-reached link
        await shareRepository.delete(shareLink.id).catch((err) =>
          logger.error('ShareService: failed to delete limit-reached link', { error: err.message })
        );
        await cacheService.del(cacheKey);
        throw new NotFoundError('Share link not found or invalid');
      }

      // Since download count changes, invalidate the cache key to avoid stale count verification
      await cacheService.del(cacheKey);
      shareLink = { ...shareLink, downloadCount: updatedLink.downloadCount };
    } else {
      // No download limit: increment download count in the background to avoid database blocking
      shareRepository.incrementDownloadCount(shareLink.id).catch((err) =>
        logger.error('ShareService: background increment failed', { error: err.message })
      );

      // Cache the share link metadata if it wasn't a cache hit
      if (!cacheHit) {
        // Calculate remaining TTL
        let ttlSeconds = 86400; // 24 hours default
        if (shareLink.expiresAt) {
          const diffMs = new Date(shareLink.expiresAt).getTime() - Date.now();
          ttlSeconds = Math.max(1, Math.floor(diffMs / 1000));
        }
        await cacheService.set(cacheKey, shareLink, ttlSeconds);
      }
    }

    // 4. Resolve chunks for streaming
    const file = shareLink.file;
    const currentVersion = file.versions[0];
    if (!currentVersion) {
      throw new NotFoundError('No content found for this file');
    }

    const fileChunks = currentVersion.chunks;
    const outputStream = new PassThrough();

    // Pipe chunks sequentially in background
    (async () => {
      try {
        for (const fc of fileChunks) {
          const chunkStream = await this.storage.download(fc.chunk.storageKey);
          await pipeline(chunkStream, outputStream, { end: false });
        }
        outputStream.end();
      } catch (error) {
        outputStream.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    })();

    return {
      stream: outputStream as Readable,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.totalSize,
    };
  }
}

export const shareService = new ShareService();
export default shareService;
