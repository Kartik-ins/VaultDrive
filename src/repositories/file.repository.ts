/**
 * @file File repository — data access layer for File, FileVersion, Chunk,
 * and FileChunk models.
 *
 * Design decisions:
 *
 * 1. Transactional operations: Methods that touch multiple tables (e.g.,
 *    creating a file + version + chunks) use Prisma interactive transactions
 *    to maintain consistency. If any step fails, all changes roll back.
 *
 * 2. BigInt serialization: Prisma returns BigInt for size fields. We handle
 *    the JSON serialization in the service layer since JSON.stringify can't
 *    serialize BigInt natively.
 *
 * 3. Pagination: List queries accept skip/take params for cursor-less
 *    offset pagination — simple and sufficient for file listings.
 */

import prisma from '../config/prisma.config';
import logger from '../config/logger.config';

export class FileRepository {
  // ─── File CRUD ───────────────────────────────────────────────────────────

  /**
   * Create a file with its first version and associated chunks in a single
   * transaction. This is the core upload path.
   *
   * The transaction ensures atomicity: if chunk creation fails, the file
   * and version records are also rolled back.
   */
  async createFileWithVersion(data: {
    filename: string;
    mimeType: string;
    totalSize: bigint;
    ownerId: string;
    sha256Hash: string;
    chunks: { sha256Hash: string; storageKey: string; size: bigint; chunkIndex: number }[];
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prisma.$transaction(async (tx: any) => {
      // 1. Create the file record
      const file = await tx.file.create({
        data: {
          filename: data.filename,
          mimeType: data.mimeType,
          totalSize: data.totalSize,
          ownerId: data.ownerId,
        },
      });

      // 2. Create version 1
      const version = await tx.fileVersion.create({
        data: {
          fileId: file.id,
          versionNum: 1,
          totalSize: data.totalSize,
          sha256Hash: data.sha256Hash,
        },
      });

      // 3. Create or reference chunks (deduplication happens here)
      for (const chunkData of data.chunks) {
        // Upsert: if a chunk with this hash already exists, reuse it
        // and increment its reference count. Otherwise, create it.
        let chunk = await tx.chunk.findUnique({
          where: { sha256Hash: chunkData.sha256Hash },
        });

        if (chunk) {
          // Chunk already exists — increment reference count (dedup!)
          chunk = await tx.chunk.update({
            where: { id: chunk.id },
            data: { referenceCount: { increment: 1 } },
          });
          logger.info('Dedup: reusing existing chunk', {
            hash: chunkData.sha256Hash,
            newRefCount: chunk.referenceCount,
          });
        } else {
          // New chunk — create it
          chunk = await tx.chunk.create({
            data: {
              sha256Hash: chunkData.sha256Hash,
              storageKey: chunkData.storageKey,
              size: chunkData.size,
              referenceCount: 1,
            },
          });
        }

        // 4. Create the join table entry (FileChunk) with ordering
        await tx.fileChunk.create({
          data: {
            fileVersionId: version.id,
            chunkId: chunk.id,
            chunkIndex: chunkData.chunkIndex,
          },
        });
      }

      // 5. Update file to point to the current version
      const updatedFile = await tx.file.update({
        where: { id: file.id },
        data: { currentVersionId: version.id },
        include: {
          versions: {
            include: {
              chunks: {
                include: { chunk: true },
                orderBy: { chunkIndex: 'asc' },
              },
            },
          },
        },
      });

      return updatedFile;
    });
  }

  /**
   * List files owned by a user with offset pagination.
   */
  async findByOwner(ownerId: string, skip: number, take: number) {
    const [files, total] = await Promise.all([
      prisma.file.findMany({
        where: { ownerId },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          totalSize: true,
          currentVersionId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.file.count({ where: { ownerId } }),
    ]);

    return { files, total };
  }

  /**
   * Find a single file by ID with its current version and chunk details.
   */
  async findById(fileId: string) {
    return prisma.file.findUnique({
      where: { id: fileId },
      include: {
        versions: {
          orderBy: { versionNum: 'desc' },
          take: 1,
          include: {
            chunks: {
              include: { chunk: true },
              orderBy: { chunkIndex: 'asc' },
            },
          },
        },
      },
    });
  }

  /**
   * Find a file by ID and verify ownership.
   * Returns null if the file doesn't exist or doesn't belong to the user.
   */
  async findByIdAndOwner(fileId: string, ownerId: string) {
    return prisma.file.findFirst({
      where: { id: fileId, ownerId },
      include: {
        versions: {
          orderBy: { versionNum: 'desc' },
          take: 1,
          include: {
            chunks: {
              include: { chunk: true },
              orderBy: { chunkIndex: 'asc' },
            },
          },
        },
      },
    });
  }

  /**
   * Delete a file and all its versions.
   *
   * Returns the chunks that were associated with the file so the service
   * layer can decrement reference counts and garbage collect orphaned chunks.
   */
  async deleteFile(fileId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prisma.$transaction(async (tx: any) => {
      // Fetch all chunk references before deleting
      const fileChunks = await tx.fileChunk.findMany({
        where: {
          fileVersion: { fileId },
        },
        include: { chunk: true },
      });

      // Decrement reference counts for all chunks
      for (const fc of fileChunks) {
        await tx.chunk.update({
          where: { id: fc.chunkId },
          data: { referenceCount: { decrement: 1 } },
        });
      }

      // Delete the file (cascades to versions → fileChunks)
      await tx.file.delete({
        where: { id: fileId },
      });

      // Find and delete any orphaned chunks (referenceCount <= 0)
      const orphanedChunks = await tx.chunk.findMany({
        where: { referenceCount: { lte: 0 } },
      });

      if (orphanedChunks.length > 0) {
        await tx.chunk.deleteMany({
          where: { referenceCount: { lte: 0 } },
        });
      }

      return {
        deletedChunkStorageKeys: orphanedChunks.map((c: { storageKey: string }) => c.storageKey),
      };
    });
  }

  // ─── Chunk operations ────────────────────────────────────────────────────

  /**
   * Find a chunk by its SHA-256 hash.
   * Used during deduplication to check if content already exists.
   */
  async findChunkByHash(sha256Hash: string) {
    return prisma.chunk.findUnique({
      where: { sha256Hash },
    });
  }

  /**
   * Get the storage keys for all chunks of a file version, ordered by index.
   * Used to reconstruct the full file during download.
   */
  async getVersionChunks(fileVersionId: string) {
    return prisma.fileChunk.findMany({
      where: { fileVersionId },
      include: { chunk: true },
      orderBy: { chunkIndex: 'asc' },
    });
  }

  /**
   * Find a file by its original filename and owner ID.
   * Used to check if an upload should create a new version of an existing file.
   */
  async findFileByNameAndOwner(filename: string, ownerId: string) {
    return prisma.file.findFirst({
      where: { filename, ownerId },
    });
  }

  /**
   * Add a new version to an existing file in an atomic transaction.
   * Monotonically increments the version number.
   */
  async addVersionToFile(fileId: string, data: {
    totalSize: bigint;
    sha256Hash: string;
    chunks: { sha256Hash: string; storageKey: string; size: bigint; chunkIndex: number }[];
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prisma.$transaction(async (tx: any) => {
      // 1. Find the current latest version number
      const latestVersion = await tx.fileVersion.findFirst({
        where: { fileId },
        orderBy: { versionNum: 'desc' },
      });
      const nextVersionNum = latestVersion ? latestVersion.versionNum + 1 : 1;

      // 2. Create the new file version record
      const version = await tx.fileVersion.create({
        data: {
          fileId,
          versionNum: nextVersionNum,
          totalSize: data.totalSize,
          sha256Hash: data.sha256Hash,
        },
      });

      // 3. Create or reference chunks (incrementing referenceCount for duplicates)
      for (const chunkData of data.chunks) {
        let chunk = await tx.chunk.findUnique({
          where: { sha256Hash: chunkData.sha256Hash },
        });

        if (chunk) {
          chunk = await tx.chunk.update({
            where: { id: chunk.id },
            data: { referenceCount: { increment: 1 } },
          });
          logger.info('Dedup: reusing existing chunk for new version', {
            hash: chunkData.sha256Hash,
            newRefCount: chunk.referenceCount,
          });
        } else {
          chunk = await tx.chunk.create({
            data: {
              sha256Hash: chunkData.sha256Hash,
              storageKey: chunkData.storageKey,
              size: chunkData.size,
              referenceCount: 1,
            },
          });
        }

        // 4. Link version to chunk
        await tx.fileChunk.create({
          data: {
            fileVersionId: version.id,
            chunkId: chunk.id,
            chunkIndex: chunkData.chunkIndex,
          },
        });
      }

      // 5. Update the parent file's currentVersionId and size metadata
      const updatedFile = await tx.file.update({
        where: { id: fileId },
        data: {
          currentVersionId: version.id,
          totalSize: data.totalSize,
        },
        include: {
          versions: {
            include: {
              chunks: {
                include: { chunk: true },
                orderBy: { chunkIndex: 'asc' },
              },
            },
            orderBy: { versionNum: 'desc' },
          },
        },
      });

      return updatedFile;
    });
  }

  /**
   * Retrieve all versions of a file, sorted from newest to oldest.
   */
  async findVersionsByFileId(fileId: string) {
    return prisma.fileVersion.findMany({
      where: { fileId },
      orderBy: { versionNum: 'desc' },
      include: {
        chunks: {
          include: { chunk: true },
          orderBy: { chunkIndex: 'asc' },
        },
      },
    });
  }

  /**
   * Retrieve a specific version by its version ID.
   */
  async findVersionById(versionId: string) {
    return prisma.fileVersion.findUnique({
      where: { id: versionId },
      include: {
        chunks: {
          include: { chunk: true },
          orderBy: { chunkIndex: 'asc' },
        },
      },
    });
  }
}

export const fileRepository = new FileRepository();
