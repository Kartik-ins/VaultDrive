/**
 * @file Chunk upload controller — HTTP handler methods for chunked uploads.
 */

import { Request, Response, NextFunction } from 'express';
import { chunkUploadService } from '../services/chunk-upload.service';
import { HttpStatusCode, BadRequestError } from '../utils/errors/app.error';

/**
 * POST /files/chunk/start
 * Initialize a resumable chunked upload session.
 */
export const startSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { filename, mimeType, totalSize, totalChunks } = req.body;

    const result = await chunkUploadService.startSession(req.user!.userId, {
      filename,
      mimeType,
      totalSize,
      totalChunks,
    });

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'Upload session initialized successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /files/chunk/:sessionId/upload
 * Upload a single binary chunk.
 * Supports both multipart/form-data (under 'chunk' field) and raw octet-streams.
 */
export const uploadChunk = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.sessionId as string;
    const chunkIndex = parseInt(req.query.chunkIndex as string);

    if (isNaN(chunkIndex)) {
      throw new BadRequestError('Missing or invalid chunkIndex query parameter');
    }

    let buffer: Buffer;

    if (req.file) {
      buffer = req.file.buffer;
    } else {
      // Accumulate raw request stream if sent directly (e.g. application/octet-stream)
      buffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('error', (err) => reject(err));
        req.on('end', () => resolve(Buffer.concat(chunks)));
      });
    }

    if (!buffer || buffer.length === 0) {
      throw new BadRequestError('No binary chunk content provided');
    }

    const result = await chunkUploadService.uploadChunk(
      sessionId,
      req.user!.userId,
      chunkIndex,
      buffer
    );

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'Chunk uploaded successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /files/chunk/:sessionId/status
 * Retrieve session upload progress.
 */
export const getSessionStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.sessionId as string;

    const result = await chunkUploadService.getSessionStatus(
      sessionId,
      req.user!.userId
    );

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'Session status retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /files/chunk/:sessionId/complete
 * Verify and assemble all uploaded chunks to form the final file.
 */
export const completeUpload = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.sessionId as string;

    const result = await chunkUploadService.completeUpload(
      sessionId,
      req.user!.userId
    );

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'File assembled successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
