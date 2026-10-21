import express from 'express';
import { signup, login, getMe, updateMe } from '../controller/authController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { validate, signupSchema, loginSchema } from '../middleware/validationMiddleware.js';

const router = express.Router()

router.post('/signup', validate(signupSchema) ,signup);

router.post('/login', validate(loginSchema), login);

router.get('/me',authMiddleware, getMe)

// PATCH /api/auth/me: check token first, then update the profile
router.patch('/me', authMiddleware, updateMe);

export default router;