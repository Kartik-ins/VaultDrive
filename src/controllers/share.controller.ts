/**
 * @file Share controller — HTTP request handlers for Share Links.
 *
 * Enforces layering: parses HTTP requests, extracts parameters, delegates to
 * ShareService, and formats the HTTP responses.
 */

import { Request, Response, NextFunction } from 'express';
import { shareService } from '../services/share.service';
import { HttpStatusCode } from '../utils/errors/app.error';

/**
 * POST /files/:id/share
 * Generate a cryptographically secure, public share link for a file.
 * Requires user authentication.
 */
export const createShareLink = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileId = req.params.id as string;
    const { expiresAt, maxDownloads } = req.body;
    
    // Read headers to construct absolute URL dynamically
    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol || 'http';

    const result = await shareService.createShareLink(
      fileId,
      req.user!.userId,
      { expiresAt, maxDownloads },
      protocol,
      host
    );

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'Share link created successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /share/:token
 * Access a public share link. Streams the file contents directly.
 * Public endpoint — no Authorization headers required.
 */
export const accessShareLink = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params.token as string;
    const result = await shareService.accessShareLink(token);


    // Set binary download headers
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', result.size.toString());

    // Stream the binary segments directly into the response
    result.stream.pipe(res);
  } catch (error) {
    next(error);
  }
};
