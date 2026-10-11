import pool from '../config/db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

export const signup = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password ){
            return res.status(400).json({ error: 'Please add all fields' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: "Min. is 8 char"})
        }

        const corrected_email = email.trim().toLowerCase()

        // check if the user exists
        const existingUser = await pool.query(
            `SELECT id FROM users WHERE email = $1`,
            [corrected_email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'User with this email exists' });
        }

        const password_hash = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `INSERT INTO users (name, email, password)
            VALUES ($1, $2, $3)
            RETURNING id, name, email`,
            [name, corrected_email, password_hash]
        );

        const user = result.rows[0];
        const payload = { id: user.id};
        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            {expiresIn: '1h'}
        );

        res.status(201).json({
            message: 'Account created',
            token,
            user
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: "user already exist"});
        }
        console.error('signup error:', error.message);
        res.status(500).json({error: 'Server error'});
    }
}

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({error: "input both email and password"});
        }

        const corrected_email = email.trim().toLowerCase();

        const result = await pool.query(
            'SELECT id, name, email, password FROM users WHERE email = $1',
            [corrected_email]
        );

        if (result.rows.length === 0 ) {
            return res.status(401).json({error: "Invalid email or password"});
        }

        const user = result.rows[0];

        if (!user.password) {
            return res.status(401).json({ error: "Invalid email or password"});
        }

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch){
            return res.status(401).json({ error: "Invalid email or password"})
        }

        const payload = { id: user.id};
        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            {expiresIn: '1h'}
        );

        res.status(200).json({
            message: 'Login Successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        console.error('login error:', error.message);
        res.status(500).json({error: 'Server error'});
    }
}

export const me = async (req, res) => {
    try{
        const userId = req.userId;

        const result = await pool.query(
            'SELECT id, name, email FROM users WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({error: 'User not found'});
        }

        const user = result.rows[0];

        return res.status(200).json({ user })
    } catch (error) {
        console.error('getMe error:', error.message);
        res.status(500).json({error: 'Server error'});
    }
}