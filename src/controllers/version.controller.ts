/**
 * @file Version controller — HTTP request handlers for file versioning endpoints.
 */

import { Request, Response, NextFunction } from 'express';
import { versionService } from '../services/version.service';
import { HttpStatusCode } from '../utils/errors/app.error';

/**
 * GET /files/:id/versions
 * Retrieve the complete version history of a file.
 */
export const getVersionHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileId = req.params.id as string;
    const ownerId = req.user!.userId;

    const result = await versionService.getVersionHistory(fileId, ownerId);

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'Version history retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /files/:id/restore/:versionId
 * Restore a file to a specific previous version.
 */
export const restoreVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileId = req.params.id as string;
    const versionId = req.params.versionId as string;
    const ownerId = req.user!.userId;

    const result = await versionService.restoreVersion(fileId, versionId, ownerId);

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'File version restored successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
