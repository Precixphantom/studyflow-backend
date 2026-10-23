// Import Express so we can create a router
import express from 'express';
// Import the four controller functions (named exports need curly braces)
import { createNote, getNotes, updateNote, deleteNote } from '../controller/noteController.js';
// Import the middleware that checks the token
import { authMiddleware } from '../middleware/authMiddleware.js';

// Create a mini-app that holds the note routes
const router = express.Router();

// POST /api/notes: check token, then create
router.post('/', authMiddleware, createNote);
// GET /api/notes: check token, then list
router.get('/', authMiddleware, getNotes);
// PATCH /api/notes/5: the :id becomes req.params.id
router.patch('/:id', authMiddleware, updateNote);
// DELETE /api/notes/5: same pattern
router.delete('/:id', authMiddleware, deleteNote);

// Export the router so server.js can mount it
export default router;