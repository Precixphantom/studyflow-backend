// Import Express so we can create a router
import express from 'express';
// Import all four controller functions (named exports need curly braces)
import { createCourse, getCourses, updateCourse, deleteCourse } from '../controller/courseController.js';
// Import the middleware that checks the token
import { authMiddleware } from '../middleware/authMiddleware.js';

// Create a mini-app that holds the course routes
const router = express.Router();

// POST /api/courses: check token first, then create
router.post('/', authMiddleware, createCourse);
// GET /api/courses: check token first, then list
router.get('/', authMiddleware, getCourses);
// PATCH /api/courses/5: the :id part becomes req.params.id
router.patch('/:id', authMiddleware, updateCourse);
// DELETE /api/courses/5: same pattern
router.delete('/:id', authMiddleware, deleteCourse);

// Export the router so server.js can mount it
export default router;