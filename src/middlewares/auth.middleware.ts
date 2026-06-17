/**
 * @file JWT authentication middleware.
 *
 * Design decisions:
 *
 * 1. Bearer token scheme: The client sends the JWT in the Authorization
 *    header as "Bearer <token>". This is the industry standard for API auth.
 *
 * 2. Fail-fast: If the token is missing, malformed, or expired, the request
 *    is rejected immediately with a 401 Unauthorized response. No downstream
 *    middleware or controller is reached.
 *
 * 3. Minimal payload: The middleware only attaches `userId` and `email` to
 *    req.user. Any additional data (name, roles) should be fetched from the
 *    database if needed.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { serverConfig } from '../config/index';
import { AuthPayload } from '../types/index';
import { UnauthorizedError } from '../utils/errors/app.error';
import logger from '../config/logger.config';

/**
 * Express middleware that verifies JWT tokens.
 *
 * Usage in routes:
 *   router.get('/protected', authenticate, controller);
 */
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication required. Provide a Bearer token.');
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('Authentication required. Token is empty.');
    }

    // Verify the token signature and expiry
    const decoded = jwt.verify(token, serverConfig.JWT_SECRET) as AuthPayload;

    // Attach the decoded payload to the request for downstream handlers
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      // Covers: invalid signature, malformed token, expired token
      logger.warn('Auth middleware: invalid token', { error: error.message });
      next(new UnauthorizedError('Invalid or expired token'));
    } else {
      next(error);
    }
  }
};
