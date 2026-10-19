// Import Express so we can create a router
import express from 'express';
// Import the four controller functions (named exports need curly braces)
import { createTask, getTasks, updateTask, deleteTask } from '../controller/taskController.js';
// Import the middleware that checks the token
import { authMiddleware } from '../middleware/authMiddleware.js';

// Create a mini-app that holds the task routes
const router = express.Router();

// POST /api/tasks: check token, then create
router.post('/', authMiddleware, createTask);
// GET /api/tasks: check token, then list
router.get('/', authMiddleware, getTasks);
// PATCH /api/tasks/5: the :id becomes req.params.id
router.patch('/:id', authMiddleware, updateTask);
// DELETE /api/tasks/5: same pattern
router.delete('/:id', authMiddleware, deleteTask);

// Export the router so server.js can mount it
export default router;