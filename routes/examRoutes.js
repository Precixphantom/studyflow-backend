// Import Express so we can create a router
import express from 'express';
// Import the five controller functions (named exports need curly braces)
import { createExam, getExams, updateExam, deleteExam, toggleChecklistTopic } from '../controller/examController.js';
// Import the middleware that checks the token
import { authMiddleware } from '../middleware/authMiddleware.js';

// Create a mini-app that holds the exam routes
const router = express.Router();

// POST /api/exams: check token, then create
router.post('/', authMiddleware, createExam);
// GET /api/exams: check token, then list
router.get('/', authMiddleware, getExams);
// PATCH /api/exams/5: the :id becomes req.params.id
router.patch('/:id', authMiddleware, updateExam);
// DELETE /api/exams/5: same pattern
router.delete('/:id', authMiddleware, deleteExam);
// PATCH /api/exams/5/checklist/12: flips or sets one topic
router.patch('/:examId/checklist/:topicId', authMiddleware, toggleChecklistTopic);

// Export the router so server.js can mount it
export default router;