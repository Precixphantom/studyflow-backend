import express from 'express';
import cookieParser from 'cookie-parser';

import { signup, login, getMe, updateMe } from '../controller/authController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { validate, signupSchema, loginSchema } from '../middleware/validationMiddleware.js';
import { googleLogin, googleCallback } from '../controller/googleAuthController.js'

const router = express.Router()

router.post('/signup', validate(signupSchema) ,signup);

router.post('/login', validate(loginSchema), login);

router.get('/me',authMiddleware, getMe)

// PATCH /api/auth/me: check token first, then update the profile
router.patch('/me', authMiddleware, updateMe);

// GET /api/auth/google: starts the login
router.get('/google', googleLogin);
// GET /api/auth/google/callback: cookieParser lets us read the saved state cookie first
router.get('/google/callback', cookieParser(), googleCallback);

export default router;