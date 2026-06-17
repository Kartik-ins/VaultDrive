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
import { getVersionHistory, restoreVersion } from '../../controllers/version.controller';
import {
  startSession,
  uploadChunk,
  getSessionStatus,
  completeUpload,
} from '../../controllers/chunk-upload.controller';
import { authenticate } from '../../middlewares/auth.middleware';
import { validateParams, validateRequestBody, validateQueryParams } from '../../validators/index';
import { fileIdParamSchema } from '../../validators/file.validator';
import { createShareLinkSchema } from '../../validators/share.validator';
import {
  startSessionSchema,
  sessionIdParamSchema,
  uploadChunkQuerySchema,
  restoreVersionParamsSchema,
} from '../../validators/chunk.validator';

// Memory storage — file buffer available as req.file.buffer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB max for single upload or chunk upload
  },
});

const fileRouter = Router();

// All file routes require authentication
fileRouter.use(authenticate);

// --- Basic File Operations ---
fileRouter.post('/upload', upload.single('file'), uploadFile);
fileRouter.get('/', listFiles);
fileRouter.get('/:id', validateParams(fileIdParamSchema), getFile);
fileRouter.get('/:id/download', validateParams(fileIdParamSchema), downloadFile);
fileRouter.delete('/:id', validateParams(fileIdParamSchema), deleteFile);

// --- Share Links ---
fileRouter.post(
  '/:id/share',
  validateParams(fileIdParamSchema),
  validateRequestBody(createShareLinkSchema),
  createShareLink
);

// --- File Versioning ---
fileRouter.get('/:id/versions', validateParams(fileIdParamSchema), getVersionHistory);
fileRouter.post(
  '/:id/restore/:versionId',
  validateParams(restoreVersionParamsSchema),
  restoreVersion
);

// --- Chunked Resumable Uploads ---
fileRouter.post('/chunk/start', validateRequestBody(startSessionSchema), startSession);
fileRouter.post(
  '/chunk/:sessionId/upload',
  validateParams(sessionIdParamSchema),
  validateQueryParams(uploadChunkQuerySchema),
  upload.single('chunk'),
  uploadChunk
);
fileRouter.get(
  '/chunk/:sessionId/status',
  validateParams(sessionIdParamSchema),
  getSessionStatus
);
fileRouter.post(
  '/chunk/:sessionId/complete',
  validateParams(sessionIdParamSchema),
  completeUpload
);

export default fileRouter;


