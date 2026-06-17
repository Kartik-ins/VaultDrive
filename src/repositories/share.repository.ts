/**
 * @file Share repository — database operations for ShareLink model.
 *
 * Encapsulates all database operations, ensuring the service layer
 * remains decoupled from Prisma Client details.
 */

import prisma from '../config/prisma.config';

export class ShareRepository {
  /**
   * Create a new share link.
   */
  async create(data: {
    fileId: string;
    token: string;
    expiresAt?: Date;
    maxDownloads?: number;
  }) {
    return prisma.shareLink.create({
      data: {
        fileId: data.fileId,
        token: data.token,
        expiresAt: data.expiresAt,
        maxDownloads: data.maxDownloads,
      },
    });
  }

  /**
   * Find a share link by its secure token.
   * Includes the associated file, latest version, and chunks needed for streaming.
   */
  async findByToken(token: string) {
    return prisma.shareLink.findUnique({
      where: { token },
      include: {
        file: {
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
        },
      },
    });
  }

  /**
   * Increment the download count atomically.
   */
  async incrementDownloadCount(id: string) {
    return prisma.shareLink.update({
      where: { id },
      data: {
        downloadCount: { increment: 1 },
      },
    });
  }

  /**
   * Delete a share link by ID.
   */
  async delete(id: string) {
    return prisma.shareLink.delete({
      where: { id },
    });
  }
}

export const shareRepository = new ShareRepository();
export default shareRepository;
