/**
 * @file File request validation schemas.
 */

import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const fileIdParamSchema = z.object({
  id: z.string().uuid('Invalid file ID format'),
});
