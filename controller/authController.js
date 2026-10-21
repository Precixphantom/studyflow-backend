import pool from '../config/db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// The users columns we send back; password is deliberately NOT in this list
const USER_COLUMNS = `id, name, email, major, university, semester, avatar, target_gpa, current_gpa, streak_days`;

// Keeps null as null, otherwise converts text like "3.85" into the number 3.85
const toNumberOrNull = (value) => (value === null ? null : Number(value));

// Turns one database row into the profile shape the frontend expects
const formatUser = (row) => ({
    // Identity fields
    id: row.id,
    name: row.name,
    email: row.email,
    // Plain profile fields pass straight through
    major: row.major,
    university: row.university,
    semester: row.semester,
    avatar: row.avatar,
    // Database target_gpa becomes targetGPA; NUMERIC arrives as text, so convert it
    targetGPA: toNumberOrNull(row.target_gpa),
    // Database current_gpa becomes currentGPA
    currentGPA: toNumberOrNull(row.current_gpa),
    // Database streak_days becomes streakDays (already a number)
    streakDays: row.streak_days
});

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
// READ: GET /api/auth/me
export const getMe = async (req, res) => {
    // Run the normal path
    try {
        // Ask Postgres for this user's profile, using the id from the verified token
        const result = await pool.query(
            `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
            // $1 is the logged-in user's id
            [req.userId]
        );

        // No row: the token is valid but the account is gone
        if (result.rows.length === 0) {
            // 401 so the frontend's route guard sends them to login
            return res.status(401).json({ error: 'User not found' });
        }

        // 200 = OK; send the full profile in frontend shape
        return res.status(200).json({ user: formatUser(result.rows[0]) });
    // If anything above crashed, land here
    } catch (error) {
        // Real error goes to your terminal
        console.error('getMe error:', error.message);
        // Vague message goes to the client
        res.status(500).json({ error: 'Server error' });
    }
};

// Helper: trims text if it was sent; stays undefined if it was not
const trimOrUndefined = (value) => (value == null ? undefined : value.trim());

// UPDATE: PATCH /api/auth/me
export const updateMe = async (req, res) => {
    // Run the normal path
    try {
        // Read ONLY the six fields we allow; anything else in the body is ignored
        const { name, major, university, semester, avatar, targetGPA } = req.body;

        // If a name was sent, it must be non-blank text of at most 255 characters
        if (name != null && (typeof name !== 'string' || !name.trim() || name.trim().length > 255)) {
            // 400 = bad request; return stops the function
            return res.status(400).json({ error: 'Name must be text of 1 to 255 characters' });
        }

        // Put the three plain text fields in one object so we can check them in a loop
        const textFields = { major, university, semester };
        // Go through each field name and value
        for (const [field, value] of Object.entries(textFields)) {
            // If it was sent, it must be text
            if (value != null && typeof value !== 'string') {
                // field is one of our own fixed names, so it is safe to show
                return res.status(400).json({ error: `${field} must be text` });
            }
        }

        // If an avatar was sent, it must be a web link (http or https) of at most 2048 characters
        if (avatar != null && (typeof avatar !== 'string' || avatar.trim().length > 2048 || !/^https?:\/\//i.test(avatar.trim()))) {
            return res.status(400).json({ error: 'Avatar must be an http or https link' });
        }

        // If targetGPA was sent, it must be a real number from 0 to 5
        if (targetGPA != null && (typeof targetGPA !== 'number' || !Number.isFinite(targetGPA) || targetGPA < 0 || targetGPA > 5)) {
            return res.status(400).json({ error: 'targetGPA must be a number from 0 to 5' });
        }

        // Send the UPDATE to Postgres
        const result = await pool.query(
            `UPDATE users
             SET
                -- COALESCE(new, old): use the new value if one was sent, otherwise keep the old one
                name = COALESCE($1, name),
                major = COALESCE($2, major),
                university = COALESCE($3, university),
                semester = COALESCE($4, semester),
                avatar = COALESCE($5, avatar),
                target_gpa = COALESCE($6, target_gpa)
             -- only the logged-in user's own row, taken from the token, never from the body
             WHERE id = $7
             -- send back the updated profile using our column list
             RETURNING ${USER_COLUMNS}`,
            // Values for $1..$7 in order; each text field is trimmed first if it was sent
            [trimOrUndefined(name), trimOrUndefined(major), trimOrUndefined(university), trimOrUndefined(semester), trimOrUndefined(avatar), targetGPA, req.userId]
        );

        // No row: the token is valid but the account is gone
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        // 200 = OK; send the updated profile
        return res.status(200).json({ user: formatUser(result.rows[0]) });
    } catch (error) {
        console.error('updateMe error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};