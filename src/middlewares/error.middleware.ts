/**
 * @file Centralized error handling middleware.
 *
 * Design decision: Two middleware functions handle different error categories:
 *
 * 1. appErrorHandler: Catches known application errors (AppError subclasses)
 *    that have a specific HTTP status code and message. These are intentional
 *    errors like "User not found" or "Invalid credentials".
 *
 * 2. genericErrorHandler: Catches unexpected errors (bugs, ORM failures, etc.)
 *    and returns a generic 500 response. The actual error is logged but never
 *    exposed to the client — preventing information leakage.
 *
 * Both use the structured logger instead of console.log for production
 * observability.
 */

import { NextFunction, Request, Response } from 'express';
import { AppError, getHttpStatusMessage, HttpStatusCode } from '../utils/errors/app.error';
import logger from '../config/logger.config';

export const appErrorHandler = (err: AppError, req: Request, res: Response, next: NextFunction) => {
  logger.error('Application error', {
    name: err.name,
    message: err.message,
    statusCode: err.statusCode,
    path: req.path,
    method: req.method,
  });

  res.status(err.statusCode).json({
    success: false,
    message: err.message,
  });
};

export const genericErrorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(HttpStatusCode.InternalServerError).json({
    success: false,
    message: getHttpStatusMessage(HttpStatusCode.InternalServerError),
  });
};