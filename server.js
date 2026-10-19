import express from 'express';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js'
import courseRoutes from './routes/courseRoutes.js'
import cors from 'cors';

dotenv.config();

const app = express()

app.use(express.json());

app.use(cors());

app.get('/health', (req, res) => {
    res.status(200).json({message: "Running perfectly"});
});

// auth routes
app.use('/api/auth', authRoutes);

// course routes
app.use('/api/courses', courseRoutes);

app.listen(process.env.PORT, () => {
    console.log('Server is running on port', `${process.env.PORT}`);
});