/**
 * @file User repository — data access layer for the User model.
 *
 * Design decision: The repository pattern encapsulates all Prisma queries,
 * keeping the service layer ORM-agnostic. If we ever migrate from Prisma
 * to another ORM (or raw SQL), only this file changes.
 *
 * All methods return plain data (no Prisma-specific types leak out).
 */

import prisma from '../config/prisma.config';

export class UserRepository {
  /**
   * Create a new user with a pre-hashed password.
   * The password is hashed in the service layer — the repository never
   * sees plaintext passwords.
   */
  async create(data: { email: string; password: string; name: string }) {
    return prisma.user.create({
      data: {
        email: data.email,
        password: data.password,
        name: data.name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });
  }

  /**
   * Find user by email — used during login to verify credentials.
   * Includes the password hash for bcrypt comparison.
   */
  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  /**
   * Find user by ID — used by the auth middleware to load the current user.
   * Excludes the password hash from the result.
   */
  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Check if an email is already registered.
   * More efficient than findByEmail when we only need a boolean.
   */
  async existsByEmail(email: string): Promise<boolean> {
    const count = await prisma.user.count({
      where: { email },
    });
    return count > 0;
  }
}

// Singleton instance — shared across all service calls
export const userRepository = new UserRepository();
