/**
 * @file Auth controller — HTTP request/response handling only.
 *
 * Design decision: Controllers are thin — they parse the request,
 * delegate to the service layer, and format the response. Zero business
 * logic lives here. This makes the service layer independently testable.
 */

import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { HttpStatusCode } from '../utils/errors/app.error';

/**
 * POST /auth/register
 * Creates a new user account and returns a JWT token.
 */
export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = req.body;
    const result = await authService.register({ email, password, name });

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'User registered successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /auth/login
 * Authenticates a user and returns a JWT token.
 */
export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login({ email, password });

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'Login successful',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /auth/me
 * Returns the current authenticated user's profile.
 * Requires a valid JWT token (enforced by auth middleware).
 */
export const getMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const user = await authService.getProfile(userId);

    res.status(HttpStatusCode.Ok).json({
      success: true,
      message: 'User profile retrieved',
      data: user,
    });
  } catch (error) {
    next(error);
  }
};
