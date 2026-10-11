import express from 'express';
import { signup, login, me } from '../controller/authController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router()

router.post('/signup', signup);

router.post('/login', login);

router.get('/me',authMiddleware, me)

export default router;