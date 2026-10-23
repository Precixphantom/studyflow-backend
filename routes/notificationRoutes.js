// Import Express so we can create a router
import express from 'express';
// Import the three controller functions (named exports need curly braces)
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../controller/notificationController.js';
// Import the middleware that checks the token
import { authMiddleware } from '../middleware/authMiddleware.js';

// Create a mini-app that holds the notification routes
const router = express.Router();

// GET /api/notifications: check token, then list (this also creates any new alerts)
router.get('/', authMiddleware, getNotifications);
// PATCH /api/notifications/read-all: this MUST come before the :id route below
router.patch('/read-all', authMiddleware, markAllNotificationsRead);
// PATCH /api/notifications/5: the :id becomes req.params.id
router.patch('/:id', authMiddleware, markNotificationRead);

// Export the router so server.js can mount it
export default router;