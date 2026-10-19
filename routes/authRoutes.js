import express from 'express';
import { signup, login, me } from '../controller/authController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { validate, signupSchema, loginSchema } from '../middleware/validationMiddleware.js';

const router = express.Router()

router.post('/signup', validate(signupSchema) ,signup);

router.post('/login', validate(loginSchema), login);

router.get('/me',authMiddleware, me)

export default router;