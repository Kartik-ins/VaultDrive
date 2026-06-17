/**
 * @file Express Request augmentation.
 *
 * After the JWT auth middleware verifies a token, it attaches the decoded
 * payload to `req.user`. This declaration merges the `user` property into
 * Express's Request interface so TypeScript recognizes it everywhere.
 */

import { AuthPayload } from './index';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}
