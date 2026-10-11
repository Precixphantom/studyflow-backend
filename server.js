import express from 'express';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js'

dotenv.config();

const app = express()

app.use(express.json());

app.get('/health', (req, res) => {
    res.status(200).json({message: "Running perfectly"});
});

// auth routes
app.use('/api/auth', authRoutes);

app.listen(process.env.PORT, () => {
    console.log('Server is running on port', `${process.env.PORT}`);
});