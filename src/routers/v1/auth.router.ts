/**
 * @file Auth router — wires auth endpoints to controllers.
 *
 * POST /auth/register  — Create a new account
 * POST /auth/login     — Authenticate and receive a JWT
 * GET  /auth/me        — Get current user profile (protected)
 */

import { Router } from 'express';
import { register, login, getMe } from '../../controllers/auth.controller';
import { validateRequestBody } from '../../validators';
import { registerSchema, loginSchema } from '../../validators/auth.validator';
import { authenticate } from '../../middlewares/auth.middleware';

const authRouter = Router();

authRouter.post('/register', validateRequestBody(registerSchema), register);
authRouter.post('/login', validateRequestBody(loginSchema), login);
authRouter.get('/me', authenticate, getMe);

export default authRouter;
