/**
 * @file File controller — HTTP handlers for file operations.
 *
 * Controllers are thin wrappers: parse request → call service → send response.
 * File uploads use Multer for multipart/form-data parsing with memory storage.
 */

import { Request, Response, NextFunction } from 'express';
import { fileService } from '../services/file.service';
import { HttpStatusCode, BadRequestError } from '../utils/errors/app.error';

/**
 * POST /files/upload
 * Upload a single file. Expects multipart/form-data with a "file" field.
 */
export const uploadFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw new BadRequestError('No file provided. Use multipart/form-data with a "file" field.');
    }

    const result = await fileService.uploadFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      ownerId: req.user!.userId,
    });

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'File uploaded successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /files
 * List files for the authenticated user with pagination.
 */
export const listFiles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await fileService.listFiles(req.user!.userId, page, limit);

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'Files retrieved successfully',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /files/:id
 * Get a single file's metadata.
 */
export const getFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileId = req.params.id as string;
    const result = await fileService.getFile(fileId, req.user!.userId);

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'File retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /files/:id/download
 * Download a file as a binary stream.
 */
export const downloadFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileId = req.params.id as string;
    const result = await fileService.downloadFile(fileId, req.user!.userId);

    // Set headers for binary download
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', result.size.toString());

    // Pipe the stream directly to the response
    result.stream.pipe(res);
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /files/:id
 * Delete a file and its associated data.
 */
export const deleteFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileId = req.params.id as string;
    const result = await fileService.deleteFile(fileId, req.user!.userId);

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};
