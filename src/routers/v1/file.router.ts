/**
 * @file File router — wires file endpoints to controllers.
 *
 * All routes are protected by the authenticate middleware.
 * File upload uses Multer with memory storage (buffer available on req.file).
 *
 * Design decision: Multer is configured with memory storage rather than disk
 * storage because we need the buffer in memory anyway to compute SHA-256
 * hashes for deduplication. For very large files (>100MB), clients should
 * use the chunked upload API instead.
 */

import { Router } from 'express';
import multer from 'multer';
import {
  uploadFile,
  listFiles,
  getFile,
  downloadFile,
  deleteFile,
} from '../../controllers/file.controller';
import { createShareLink } from '../../controllers/share.controller';
import { authenticate } from '../../middlewares/auth.middleware';
import { validateParams, validateRequestBody } from '../../validators/index';
import { fileIdParamSchema } from '../../validators/file.validator';
import { createShareLinkSchema } from '../../validators/share.validator';

// Memory storage — file buffer available as req.file.buffer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB max for single upload
  },
});

const fileRouter = Router();

// All file routes require authentication
fileRouter.use(authenticate);

fileRouter.post('/upload', upload.single('file'), uploadFile);
fileRouter.get('/', listFiles);
fileRouter.get('/:id', validateParams(fileIdParamSchema), getFile);
fileRouter.get('/:id/download', validateParams(fileIdParamSchema), downloadFile);
fileRouter.delete('/:id', validateParams(fileIdParamSchema), deleteFile);

// Share creation endpoint
fileRouter.post(
  '/:id/share',
  validateParams(fileIdParamSchema),
  validateRequestBody(createShareLinkSchema),
  createShareLink
);

export default fileRouter;

