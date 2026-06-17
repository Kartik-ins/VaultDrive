/**
 * @file Version service — business logic for file version history and restores.
 *
 * Design decisions:
 *
 * 1. Zero-copy restore: Restoring an older version creates a *new* FileVersion
 *    referencing the exact same chunk records. No bytes are copied or moved in
 *    S3/Filebase, making restores instant and storage-efficient.
 *
 * 2. Immutable history: We never delete old versions on restore. Instead,
 *    we push a new version to the top of the stack, preserving the full audit
 *    trail of mutations.
 *
 * 3. Serialization: Converts BigInt size fields to strings for JSON safety.
 */

import { fileRepository } from '../repositories/file.repository';
import { NotFoundError } from '../utils/errors/app.error';
import { cacheService } from './cache.service';
import logger from '../config/logger.config';

export class VersionService {
  /**
   * Get full version history for a file.
   */
  async getVersionHistory(fileId: string, ownerId: string) {
    // 1. Verify file exists and belongs to the owner
    const file = await fileRepository.findByIdAndOwner(fileId, ownerId);
    if (!file) {
      throw new NotFoundError('File not found');
    }

    // 2. Fetch versions
    const versions = await fileRepository.findVersionsByFileId(fileId);

    // 3. Serialize BigInts
    return versions.map((v) => this.serializeVersion(v));
  }

  /**
   * Restore a file to a previous version.
   * Creates a new version copy pointing to target chunks.
   */
  async restoreVersion(fileId: string, versionId: string, ownerId: string) {
    // 1. Verify file exists and belongs to the owner
    const file = await fileRepository.findByIdAndOwner(fileId, ownerId);
    if (!file) {
      throw new NotFoundError('File not found');
    }

    // 2. Retrieve target version metadata
    const version = await fileRepository.findVersionById(versionId);
    if (!version || version.fileId !== fileId) {
      throw new NotFoundError('File version not found');
    }

    logger.info('VersionService: restoring file version', {
      fileId,
      targetVersionNum: version.versionNum,
    });

    // 3. Add a new version pointing to the same chunks
    const updatedFile = await fileRepository.addVersionToFile(fileId, {
      totalSize: version.totalSize,
      sha256Hash: version.sha256Hash,
      chunks: version.chunks.map((fc) => ({
        sha256Hash: fc.chunk.sha256Hash,
        storageKey: fc.chunk.storageKey,
        size: fc.chunk.size,
        chunkIndex: fc.chunkIndex,
      })),
    });

    // 4. Invalidate the file cache
    await cacheService.del(`vaultdrive:file:${fileId}`);

    logger.info('VersionService: version restored', {
      fileId,
      newVersionNum: updatedFile.versions[0].versionNum,
    });

    // Extract the latest version from updated file
    const latestVersion = updatedFile.versions[0];
    return this.serializeVersion(latestVersion);
  }

  /**
   * Helper to format Prisma Version models for JSON transmission.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private serializeVersion(v: any) {
    return {
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
    };
  }
}

export const versionService = new VersionService();
export default versionService;
