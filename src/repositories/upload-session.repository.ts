/**
 * @file Upload session repository — database queries for resumable uploads.
 */

import prisma from '../config/prisma.config';

export class UploadSessionRepository {
  /**
   * Create a new upload session.
   */
  async create(data: {
    userId: string;
    filename: string;
    mimeType: string;
    totalSize: bigint;
    totalChunks: number;
    chunkSize: number;
    expiresAt: Date;
  }) {
    return prisma.uploadSession.create({
      data: {
        userId: data.userId,
        filename: data.filename,
        mimeType: data.mimeType,
        totalSize: data.totalSize,
        totalChunks: data.totalChunks,
        chunkSize: data.chunkSize,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Find an upload session by ID.
   */
  async findById(id: string) {
    return prisma.uploadSession.findUnique({
      where: { id },
    });
  }

  /**
   * Update the JSON array of uploaded chunks.
   * Stores an array of `{ index: number, hash: string, size: number }` items.
   */
  async updateUploadedChunks(id: string, uploadedChunks: unknown) {
    return prisma.uploadSession.update({
      where: { id },
      data: {
        uploadedChunks: uploadedChunks as any,
      },
    });
  }

  /**
   * Update the session status (e.g., 'completed', 'expired').
   */
  async updateStatus(id: string, status: string) {
    return prisma.uploadSession.update({
      where: { id },
      data: { status },
    });
  }
}

export const uploadSessionRepository = new UploadSessionRepository();
export default uploadSessionRepository;
