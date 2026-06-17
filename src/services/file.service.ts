/**
 * @file File service — business logic for file upload, download, list, delete.
 *
 * Design decisions:
 *
 * 1. Single-file upload splits the buffer into chunks even for small files.
 *    This keeps the code path uniform — whether a file is 100 KB or 100 MB,
 *    it goes through the same chunking → hashing → dedup → storage pipeline.
 *
 * 2. SHA-256 hashing: We hash both individual chunks and the entire file.
 *    - Chunk hash: used for content-addressable dedup in object storage.
 *    - File hash: stored in FileVersion for integrity verification.
 *
 * 3. Download streams: The download method pipes chunk streams in sequence,
 *    reconstructing the original file without loading it entirely in memory.
 *    For single-chunk files this is trivially efficient; for multi-chunk
 *    files it prevents OOM on the server.
 *
 * 4. BigInt → string serialization: Prisma returns BigInt for size fields.
 *    We convert to string in response formatting since JSON.stringify
 *    can't handle BigInt.
 */

import crypto from 'crypto';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { fileRepository } from '../repositories/file.repository';
import { getStorageProvider } from '../storage/index';
import { serverConfig } from '../config/index';
import { NotFoundError } from '../utils/errors/app.error';
import { cacheService } from './cache.service';
import logger from '../config/logger.config';

export class FileService {
  private storage = getStorageProvider();

  /**
   * Upload a single file.
   *
   * Flow:
   * 1. Compute SHA-256 hash of the entire file (for version integrity).
   * 2. Split into chunks based on CHUNK_SIZE_BYTES.
   * 3. For each chunk: hash → dedup check → upload if new.
   * 4. Create File + FileVersion + Chunk + FileChunk records atomically.
   */
  async uploadFile(data: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
    ownerId: string;
  }) {
    const { buffer, filename, mimeType, ownerId } = data;
    const totalSize = BigInt(buffer.length);

    logger.info('FileService: starting upload', { filename, size: buffer.length });

    // 1. Hash the entire file for version-level integrity
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    // 2. Split into chunks
    const chunkSize = serverConfig.CHUNK_SIZE_BYTES;
    const chunks: { sha256Hash: string; storageKey: string; size: bigint; chunkIndex: number; buffer: Buffer }[] = [];

    for (let i = 0; i * chunkSize < buffer.length; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, buffer.length);
      const chunkBuffer = buffer.subarray(start, end);

      const chunkHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex');
      const storageKey = `chunks/${chunkHash}`;

      chunks.push({
        sha256Hash: chunkHash,
        storageKey,
        size: BigInt(chunkBuffer.length),
        chunkIndex: i,
        buffer: chunkBuffer,
      });
    }

    // 3. Upload chunks to storage (skip if already exists — dedup)
    for (const chunk of chunks) {
      const existingChunk = await fileRepository.findChunkByHash(chunk.sha256Hash);

      if (existingChunk) {
        logger.info('FileService: chunk already exists (dedup)', {
          hash: chunk.sha256Hash,
        });
        continue; // Skip upload — content already in storage
      }

      await this.storage.upload(chunk.storageKey, chunk.buffer);
      logger.info('FileService: chunk uploaded', {
        hash: chunk.sha256Hash,
        size: chunk.buffer.length,
      });
    }

    // 4. Create all database records atomically
    const file = await fileRepository.createFileWithVersion({
      filename,
      mimeType,
      totalSize,
      ownerId,
      sha256Hash: fileHash,
      chunks: chunks.map((c) => ({
        sha256Hash: c.sha256Hash,
        storageKey: c.storageKey,
        size: c.size,
        chunkIndex: c.chunkIndex,
      })),
    });

    logger.info('FileService: upload complete', { fileId: file.id });
    const serialized = this.serializeFile(file);
    await cacheService.set(`vaultdrive:file:${file.id}`, serialized, 300); // Cache for 5 mins
    return serialized;
  }

  /**
   * List files for the authenticated user with pagination.
   */
  async listFiles(ownerId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { files, total } = await fileRepository.findByOwner(ownerId, skip, limit);

    return {
      data: files.map((f: { totalSize: bigint; [key: string]: unknown }) => ({
        ...f,
        totalSize: f.totalSize.toString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single file's metadata.
   */
  async getFile(fileId: string, ownerId: string) {
    const cacheKey = `vaultdrive:file:${fileId}`;
    const cachedFile = await cacheService.get<any>(cacheKey);

    if (cachedFile) {
      logger.info('FileService: cache hit for file metadata', { fileId });
      if (cachedFile.ownerId !== ownerId) {
        throw new NotFoundError('File not found');
      }
      return cachedFile;
    }

    logger.info('FileService: cache miss for file metadata', { fileId });
    const file = await fileRepository.findByIdAndOwner(fileId, ownerId);

    if (!file) {
      throw new NotFoundError('File not found');
    }

    const serialized = this.serializeFile(file);
    await cacheService.set(cacheKey, serialized, 300); // Cache for 5 mins

    return serialized;
  }

  /**
   * Download a file by streaming its chunks in order.
   *
   * Design: We create a PassThrough stream and pipe each chunk's download
   * stream into it sequentially. This reconstructs the original file
   * without buffering the entire content in memory.
   */
  async downloadFile(fileId: string, ownerId: string) {
    const file = await fileRepository.findByIdAndOwner(fileId, ownerId);

    if (!file) {
      throw new NotFoundError('File not found');
    }

    const currentVersion = file.versions[0];
    if (!currentVersion) {
      throw new NotFoundError('No version found for this file');
    }

    // Get ordered chunk storage keys
    const fileChunks = await fileRepository.getVersionChunks(currentVersion.id);

    // Create a pass-through stream that we'll pipe all chunks into
    const outputStream = new PassThrough();

    // Pipe chunks sequentially in the background
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

  /**
   * Delete a file and clean up orphaned chunks from storage.
   *
   * Flow:
   * 1. Verify ownership.
   * 2. Delete DB records (cascading) and get orphaned chunk keys.
   * 3. Delete orphaned chunk objects from storage.
   */
  async deleteFile(fileId: string, ownerId: string) {
    const file = await fileRepository.findByIdAndOwner(fileId, ownerId);

    if (!file) {
      throw new NotFoundError('File not found');
    }

    const { deletedChunkStorageKeys } = await fileRepository.deleteFile(fileId);

    // Clean up orphaned chunks from object storage
    for (const key of deletedChunkStorageKeys) {
      try {
        await this.storage.delete(key);
        logger.info('FileService: orphaned chunk deleted from storage', { key });
      } catch (error) {
        // Log but don't fail — orphaned objects can be cleaned up later
        logger.error('FileService: failed to delete orphaned chunk', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Invalidate cache
    await cacheService.del(`vaultdrive:file:${fileId}`);

    logger.info('FileService: file deleted', { fileId });
    return { message: 'File deleted successfully' };
  }

  /**
   * Serialize a Prisma file record for JSON response.
   * Converts BigInt to string since JSON.stringify can't handle BigInt.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private serializeFile(file: any) {
    return {
      ...file,
      totalSize: file.totalSize?.toString(),
      versions: file.versions?.map((v: any) => ({
        ...v,
        totalSize: v.totalSize?.toString(),
        chunks: v.chunks?.map((fc: any) => ({
          ...fc,
          chunk: fc.chunk
            ? {
                ...fc.chunk,
                size: fc.chunk.size?.toString(),
              }
            : undefined,
        })),
      })),
    };
  }
}

export const fileService = new FileService();
