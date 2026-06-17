/**
 * @file V1 API router — registers all feature routers.
 *
 * All routes are prefixed with /api/v1 (set in server.ts).
 * Feature routers handle their own auth requirements — some routes
 * (like auth/register) are public, while file operations require JWT.
 */

import express from 'express';
import pingRouter from './ping.router';
import authRouter from './auth.router';
import fileRouter from './file.router';
import shareRouter from './share.router';

const v1Router = express.Router();

v1Router.use('/ping', pingRouter);
v1Router.use('/auth', authRouter);
v1Router.use('/files', fileRouter);
v1Router.use('/share', shareRouter);

export default v1Router;