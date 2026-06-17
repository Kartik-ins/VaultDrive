/**
 * @file Share router — maps share consumption routes.
 *
 * This router is public (unauthenticated) because share links must be accessible
 * to anyone who has the valid token.
 */

import { Router } from 'express';
import { accessShareLink } from '../../controllers/share.controller';
import { validateParams } from '../../validators/index';
import { shareTokenParamSchema } from '../../validators/share.validator';

const shareRouter = Router();

// Public endpoint for streaming a shared file
shareRouter.get(
  '/:token',
  validateParams(shareTokenParamSchema),
  accessShareLink
);

export default shareRouter;
