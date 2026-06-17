/**
 * @file Share validator — validation schemas for sharing endpoints.
 */

import { z } from 'zod';

export const createShareLinkSchema = z.object({
  expiresAt: z
    .string()
    .datetime({ message: 'Expiration must be a valid ISO 8601 date-time string' })
    .optional()
    .nullable()
    .refine(
      (val) => {
        if (!val) return true;
        return new Date(val) > new Date();
      },
      { message: 'Expiration date must be in the future' }
    )
    .transform((val) => (val ? new Date(val) : undefined)),
  maxDownloads: z
    .number()
    .int()
    .min(1, 'Maximum downloads must be at least 1')
    .optional()
    .nullable()
    .transform((val) => (val === null ? undefined : val)),
});

export const shareTokenParamSchema = z.object({
  token: z
    .string()
    .min(1, 'Token is required')
    .regex(/^[a-f0-9]{64}$/, 'Invalid share token format'), // 32-byte hex is 64 chars
});
