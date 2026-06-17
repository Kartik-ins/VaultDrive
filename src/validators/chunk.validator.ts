/**
 * @file Chunk validator — Zod schemas for chunked uploads and version restores.
 */

import { z } from 'zod';

export const startSessionSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  mimeType: z.string().min(1, 'Mime type is required'),
  totalSize: z.coerce
    .number()
    .int()
    .positive('Total size must be greater than 0')
    .or(z.string().regex(/^\d+$/).transform((v) => BigInt(v))),
  totalChunks: z.coerce.number().int().positive('Total chunks must be at least 1'),
});

export const sessionIdParamSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID format'),
});

export const uploadChunkQuerySchema = z.object({
  chunkIndex: z.coerce
    .number()
    .int()
    .nonnegative('Chunk index must be greater than or equal to 0'),
});

export const restoreVersionParamsSchema = z.object({
  id: z.string().uuid('Invalid file ID format'),
  versionId: z.string().uuid('Invalid version ID format'),
});
