/**
 * @file Shared TypeScript types and interfaces for VaultDrive.
 *
 * Design note: These types are intentionally decoupled from Prisma models.
 * Controllers and services work with these domain types rather than
 * Prisma-generated types directly, keeping the domain layer independent
 * of the ORM.
 */

import { Readable } from 'stream';

// ─── Storage Provider ────────────────────────────────────────────────────────
// Abstraction over object storage backends (Filebase, S3, MinIO, etc.).
// Swapping providers requires only a new implementation — zero service changes.

export interface StorageProvider {
  /**
   * Upload binary content to object storage.
   * @param key   - Unique object key (e.g., "chunks/<sha256>")
   * @param buffer - File/chunk contents
   * @returns The storage key (echoed back for confirmation)
   */
  upload(key: string, buffer: Buffer): Promise<string>;

  /**
   * Download an object as a readable stream.
   * Streams avoid loading entire files into memory — critical for large files.
   */
  download(key: string): Promise<Readable>;

  /**
   * Permanently delete an object from storage.
   * Used during garbage collection when a chunk's reference count hits zero.
   */
  delete(key: string): Promise<void>;

  /**
   * Check whether an object exists without downloading it.
   * Uses HEAD request under the hood — cheap and fast.
   */
  exists(key: string): Promise<boolean>;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

/** JWT payload claims — embedded in every signed token. */
export interface AuthPayload {
  userId: string;
  email: string;
}

// ─── Pagination ──────────────────────────────────────────────────────────────

/** Query params for paginated list endpoints. */
export interface PaginationParams {
  page: number;
  limit: number;
}

/** Standardized paginated response envelope. */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── API Response ────────────────────────────────────────────────────────────

/** Standardized success response envelope. */
export interface ApiResponse<T = unknown> {
  success: true;
  message: string;
  data?: T;
}

/** Standardized error response envelope. */
export interface ApiErrorResponse {
  success: false;
  message: string;
  errors?: unknown;
}
