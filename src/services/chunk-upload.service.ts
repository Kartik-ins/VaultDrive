/**
 * @file Chunk upload service — resumable chunked upload flows.
 *
 * Design decisions:
 *
 * 1. Server-side size validation: We enforce strict size boundaries for every
 *    chunk. Non-terminal chunks must match `chunkSize` exactly, and the last
 *    chunk must match the remaining bytes of `totalSize`. This prevents client
 *    tampering with file sizes.
 *
 * 2. Cache-aside for Session queries: Upload session metadata is cached in
 *    Redis with a 24h expiration. Status queries check Redis first, ensuring
 *    resumption checks are instantaneous and bypass DB stress.
 *
 * 3. Content-addressable deduplication: Each chunk buffer is hashed (SHA-256)
 *    on upload. If the chunk already exists in the database, S3 upload is skipped.
 *
 * 4. Sequential Hashing Stream Assembly: When finalizing the upload, we do
 *    not pull the whole file in memory. We download chunk streams sequentially,
 *    pipe them to a SHA-256 hash generator, and calculate the overall version
 *    hash safely before writing DB records in a single transaction.
 */

import crypto from 'crypto';
import { uploadSessionRepository } from '../repositories/upload-session.repository';
import { fileRepository } from '../repositories/file.repository';
import { getStorageProvider } from '../storage/index';
import { cacheService } from './cache.service';
import { NotFoundError, BadRequestError } from '../utils/errors/app.error';
import logger from '../config/logger.config';

export class ChunkUploadService {
  private storage = getStorageProvider();

  /**
   * Start a new chunked upload session.
   */
  async startSession(
    userId: string,
    data: {
      filename: string;
      mimeType: string;
      totalSize: bigint;
      totalChunks: number;
    }
  ) {
    // 1. Calculate chunk size based on totalSize and totalChunks
    const totalSizeNum = Number(data.totalSize);
    const chunkSize = Math.ceil(totalSizeNum / data.totalChunks);

    if (chunkSize <= 0) {
      throw new BadRequestError('Invalid total size or chunk numbers');
    }

    // 2. Set expiration to 24 hours from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 3. Create session in DB
    const session = await uploadSessionRepository.create({
      userId,
      filename: data.filename,
      mimeType: data.mimeType,
      totalSize: data.totalSize,
      totalChunks: data.totalChunks,
      chunkSize,
      expiresAt,
    });

    const serialized = this.serializeSession(session);

    // 4. Cache session in Redis
    await cacheService.set(
      `vaultdrive:upload_session:${session.id}`,
      serialized,
      24 * 60 * 60
    );

    logger.info('ChunkUploadService: upload session started', {
      sessionId: session.id,
      filename: session.filename,
      totalChunks: session.totalChunks,
    });

    return serialized;
  }

  /**
   * Upload an individual chunk.
   */
  async uploadChunk(
    sessionId: string,
    userId: string,
    chunkIndex: number,
    buffer: Buffer
  ) {
    // 1. Get session details (validating owner and status)
    const session = await this.getValidatedSession(sessionId, userId);

    // 2. Enforce chunk size boundaries
    const isLastChunk = chunkIndex === session.totalChunks - 1;
    const expectedSize = isLastChunk
      ? Number(session.totalSize) - (session.totalChunks - 1) * session.chunkSize
      : session.chunkSize;

    if (buffer.length !== expectedSize) {
      throw new BadRequestError(
        `Invalid chunk size. Expected ${expectedSize} bytes, got ${buffer.length}`
      );
    }

    // 3. Compute chunk SHA-256 hash
    const chunkHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const storageKey = `chunks/${chunkHash}`;

    // 4. Deduplicate (upload to Filebase only if chunk hash is new)
    const existingChunk = await fileRepository.findChunkByHash(chunkHash);

    if (existingChunk) {
      logger.info('ChunkUploadService: chunk already exists (dedup)', {
        sessionId,
        chunkIndex,
        hash: chunkHash,
      });
    } else {
      await this.storage.upload(storageKey, buffer);
      logger.info('ChunkUploadService: chunk uploaded to Filebase', {
        sessionId,
        chunkIndex,
        hash: chunkHash,
        size: buffer.length,
      });
    }

    // 5. Update completed chunks registry
    let uploadedChunks = session.uploadedChunks as any[];
    if (!Array.isArray(uploadedChunks)) {
      uploadedChunks = [];
    }

    // Replace if exists, or append
    const existsIdx = uploadedChunks.findIndex((c) => c.index === chunkIndex);
    const chunkRegistryItem = { index: chunkIndex, hash: chunkHash, size: buffer.length };

    if (existsIdx !== -1) {
      uploadedChunks[existsIdx] = chunkRegistryItem;
    } else {
      uploadedChunks.push(chunkRegistryItem);
    }

    // 6. Persist progress
    const updatedSession = await uploadSessionRepository.updateUploadedChunks(
      sessionId,
      uploadedChunks
    );

    const serialized = this.serializeSession(updatedSession);
    await cacheService.set(
      `vaultdrive:upload_session:${sessionId}`,
      serialized,
      24 * 60 * 60
    );

    return {
      sessionId,
      chunkIndex,
      uploaded: true,
      progress: `${uploadedChunks.length}/${session.totalChunks}`,
    };
  }

  /**
   * Get the current progress/status of an upload session.
   */
  async getSessionStatus(sessionId: string, userId: string) {
    const session = await this.getValidatedSession(sessionId, userId);
    return this.serializeSession(session);
  }

  /**
   * Complete the session and compile the file.
   */
  async completeUpload(sessionId: string, userId: string) {
    // 1. Validate session
    const session = await this.getValidatedSession(sessionId, userId);

    // 2. Verify all chunks exist
    const uploadedChunks = session.uploadedChunks as any[];
    if (
      !Array.isArray(uploadedChunks) ||
      uploadedChunks.length !== session.totalChunks
    ) {
      throw new BadRequestError('Cannot complete upload: missing chunks');
    }

    // Sort to ensure sequential order
    const sortedChunks = [...uploadedChunks].sort((a, b) => a.index - b.index);
    for (let i = 0; i < session.totalChunks; i++) {
      if (sortedChunks[i].index !== i) {
        throw new BadRequestError(`Cannot complete upload: missing chunk index ${i}`);
      }
    }

    logger.info('ChunkUploadService: finalizing upload, assembling streams', { sessionId });

    // 3. Compute the file-level hash by downloading chunk streams sequentially
    const fileHashGen = crypto.createHash('sha256');
    for (const chunkInfo of sortedChunks) {
      const chunkKey = `chunks/${chunkInfo.hash}`;
      const chunkStream = await this.storage.download(chunkKey);
      
      await new Promise<void>((resolve, reject) => {
        chunkStream.on('data', (chunk) => fileHashGen.update(chunk));
        chunkStream.on('error', (err) => reject(err));
        chunkStream.on('end', () => resolve());
      });
    }
    const fileHash = fileHashGen.digest('hex');

    // 4. Update the DB: either append version to existing file or create new file
    const existingFile = await fileRepository.findFileByNameAndOwner(
      session.filename,
      userId
    );
    let file;

    const formattedChunks = sortedChunks.map((c) => ({
      sha256Hash: c.hash,
      storageKey: `chunks/${c.hash}`,
      size: BigInt(c.size),
      chunkIndex: c.index,
    }));

    if (existingFile) {
      logger.info('ChunkUploadService: file already exists, adding new version', {
        filename: session.filename,
        fileId: existingFile.id,
      });
      file = await fileRepository.addVersionToFile(existingFile.id, {
        totalSize: session.totalSize,
        sha256Hash: fileHash,
        chunks: formattedChunks,
      });
      // Invalidate file cache
      await cacheService.del(`vaultdrive:file:${existingFile.id}`);
    } else {
      logger.info('ChunkUploadService: creating new file from session', {
        filename: session.filename,
      });
      file = await fileRepository.createFileWithVersion({
        filename: session.filename,
        mimeType: session.mimeType,
        totalSize: session.totalSize,
        ownerId: userId,
        sha256Hash: fileHash,
        chunks: formattedChunks,
      });
    }

    // 5. Update session status to completed
    await uploadSessionRepository.updateStatus(
      sessionId,
      'completed'
    );

    // 6. Evict session from Redis cache
    await cacheService.del(`vaultdrive:upload_session:${sessionId}`);

    logger.info('ChunkUploadService: session completed successfully', {
      sessionId,
      fileId: file.id,
    });

    return this.serializeFile(file);
  }

  /**
   * Fetch a session from Redis cache or database and validate it.
   */
  private async getValidatedSession(sessionId: string, userId: string) {
    const cacheKey = `vaultdrive:upload_session:${sessionId}`;
    let session = await cacheService.get<any>(cacheKey);

    if (!session) {
      session = await uploadSessionRepository.findById(sessionId);
      if (session) {
        session = this.serializeSession(session);
      }
    }

    if (!session) {
      throw new NotFoundError('Upload session not found');
    }

    // Validate ownership
    if (session.userId !== userId) {
      throw new NotFoundError('Upload session not found');
    }

    // Check expiration
    if (new Date(session.expiresAt) < new Date()) {
      await uploadSessionRepository.updateStatus(sessionId, 'expired');
      await cacheService.del(cacheKey);
      throw new BadRequestError('Upload session has expired');
    }

    // Check status
    if (session.status !== 'pending') {
      throw new BadRequestError(`Upload session is already ${session.status}`);
    }

    return session;
  }

  /**
   * Helper to serialize DB Session records.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private serializeSession(session: any) {
    return {
      ...session,
      totalSize: session.totalSize?.toString(),
    };
  }

  /**
   * Helper to serialize DB File records.
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

export const chunkUploadService = new ChunkUploadService();
export default chunkUploadService;
