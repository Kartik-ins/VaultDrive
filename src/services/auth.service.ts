/**
 * @file Authentication service — business logic for user auth.
 *
 * Design decisions:
 *
 * 1. bcrypt with salt rounds of 12: Good balance between security and
 *    performance. Each hash takes ~250ms, which is fast enough for login
 *    but slow enough to make brute-force attacks impractical.
 *
 * 2. JWT tokens with 7-day expiry: Long enough for good UX, short enough
 *    to limit damage from a stolen token. In production, you'd add refresh
 *    token rotation.
 *
 * 3. Service never returns password hashes: The register method returns
 *    user data without the password field. The login method returns only
 *    the JWT token.
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories/user.repository';
import { serverConfig } from '../config/index';
import { AuthPayload } from '../types/index';
import { ConflictError, UnauthorizedError, NotFoundError } from '../utils/errors/app.error';
import logger from '../config/logger.config';

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = '7d';

export class AuthService {
  /**
   * Register a new user.
   *
   * Flow: validate uniqueness → hash password → persist → sign JWT.
   * The password is hashed before it ever touches the database.
   */
  async register(data: { email: string; password: string; name: string }) {
    logger.info('AuthService: registering user', { email: data.email });

    // Check for existing user first to provide a clear error message
    const exists = await userRepository.existsByEmail(data.email);
    if (exists) {
      throw new ConflictError('A user with this email already exists');
    }

    // Hash password — bcrypt automatically generates a unique salt per hash
    const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);

    const user = await userRepository.create({
      email: data.email,
      password: hashedPassword,
      name: data.name,
    });

    // Generate JWT immediately so the user is "logged in" after registration
    const token = this.generateToken({ userId: user.id, email: user.email });

    logger.info('AuthService: user registered successfully', { userId: user.id });

    return { user, token };
  }

  /**
   * Authenticate a user with email + password.
   *
   * Flow: find user → compare bcrypt hash → sign JWT.
   * We deliberately use the same error message for "user not found" and
   * "wrong password" to prevent email enumeration attacks.
   */
  async login(data: { email: string; password: string }) {
    logger.info('AuthService: login attempt', { email: data.email });

    const user = await userRepository.findByEmail(data.email);
    if (!user) {
      // Generic message prevents email enumeration
      throw new UnauthorizedError('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = this.generateToken({ userId: user.id, email: user.email });

    logger.info('AuthService: login successful', { userId: user.id });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token,
    };
  }

  /**
   * Get the current user's profile.
   * Called from the GET /auth/me endpoint after JWT middleware has verified
   * the token and attached `req.user`.
   */
  async getProfile(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  /**
   * Generate a signed JWT token.
   *
   * The payload contains only userId and email — minimal claims to keep
   * tokens small. Any additional user data should be fetched from the DB.
   */
  private generateToken(payload: AuthPayload): string {
    return jwt.sign(payload, serverConfig.JWT_SECRET, {
      expiresIn: TOKEN_EXPIRY,
    });
  }
}

export const authService = new AuthService();
