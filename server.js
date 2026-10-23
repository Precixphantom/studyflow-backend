import express from 'express';
import dotenv from 'dotenv';
import passport from './config/passport.js';
import authRoutes from './routes/authRoutes.js'
import courseRoutes from './routes/courseRoutes.js'
import taskRoutes from './routes/taskRoutes.js'
import assignmentRoutes from'./routes/assignmentRoutes.js';
import examRoutes from './routes/examRoutes.js';
import noteRoutes from './routes/noteRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import cors from 'cors';

dotenv.config();

const app = express()

app.use(express.json());

app.use(cors());

app.use(passport.initialize());

app.get('/health', (req, res) => {
    res.status(200).json({message: "Running perfectly"});
});

// auth routes
app.use('/api/auth', authRoutes);

// course routes
app.use('/api/courses', courseRoutes);

// task routes
app.use('/api/tasks', taskRoutes);

// assignment routes
app.use('/api/assignments', assignmentRoutes);

// exam routes
app.use('/api/exams', examRoutes);

// note routes
app.use('/api/notes', noteRoutes);

// notification routes
app.use('/api/notifications', notificationRoutes);

// Catch-all: runs only if no route above matched the request
app.use((req, res) => {
    // Reply with JSON so the frontend always gets { error }, never an HTML page
    res.status(404).json({ error: "Route not found" });
});

// Error handler: Express knows it is one because it takes FOUR parameters
app.use((err, req, res, next) => {
    // Print the real error in your own terminal
    console.error("unhandled error:", err.message);
    // Broken JSON arrives with err.status set to 400; anything else counts as a 500
    const status = err.status || 500;
    // Vague message for server bugs, a clear one for bad input
    res.status(status).json({ error: status === 500 ? "Server error" : "Invalid request" });
});

app.listen(process.env.PORT, () => {
    console.log('Server is running on port', `${process.env.PORT}`);
});