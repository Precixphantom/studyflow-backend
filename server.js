import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express()

app.get('/health', (req, res) => {
    res.status(200).json({message: "Running perfectly"});
});

app.listen(process.env.PORT, () => {
    console.log('Server is running');
});