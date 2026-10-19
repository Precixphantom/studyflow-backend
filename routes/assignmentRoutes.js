// Import Express so we can create a router
import express from 'express';
// Import the four controller functions (named exports need curly braces)
import { createAssignment, getAssignments, updateAssignment, deleteAssignment } from '../controller/assignmentController.js';
// Import the middleware that checks the token
import { authMiddleware } from '../middleware/authMiddleware.js';

// Create a mini-app that holds the assignment routes
const router = express.Router();

// POST /api/assignments: check token, then create
router.post('/', authMiddleware, createAssignment);
// GET /api/assignments: check token, then list
router.get('/', authMiddleware, getAssignments);
// PATCH /api/assignments/5: the :id becomes req.params.id
router.patch('/:id', authMiddleware, updateAssignment);
// DELETE /api/assignments/5: same pattern
router.delete('/:id', authMiddleware, deleteAssignment);

// Export the router so server.js can mount it
export default router;