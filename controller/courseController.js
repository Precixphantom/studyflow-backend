// Import the database pool so this file can send SQL to Postgres
import pool from "../config/db.js";

// Helper: turns one database row into the object shape the frontend expects
const formatCourse = (row) => ({
    // The id Postgres generated for this course
    id: row.id,
    // Plain text fields pass straight through
    code: row.code,
    title: row.title,
    instructor: row.instructor,
    room: row.room,
    color: row.color,
    schedule: row.schedule,
    // Database name grade_goal becomes the frontend's gradeGoal
    gradeGoal: row.grade_goal,
    // Database name credit_hours becomes creditHours
    creditHours: row.credit_hours,
    // NUMERIC may arrive as text, so convert to a real number; keep null as null
    currentGrade: row.current_grade === null ? null : Number(row.current_grade)
});

// CREATE: POST /api/courses
export const createCourse = async (req, res) => {
    // Run the normal path; any crash jumps to the catch block below
    try {
        // Read the nine course fields from the JSON body the client sent
        const { code, title, creditHours, gradeGoal, instructor, room, color, schedule, currentGrade } = req.body;

        // Reject if code or title is missing OR not a string (a number would crash .trim())
        if (typeof code !== "string" || typeof title !== "string") {
            // 400 = the request is bad; return stops the function here
            return res.status(400).json({ error: "Course code and title are required" });
        }

        // Remove spaces from both ends of code
        const cleanCode = code.trim();
        // Remove spaces from both ends of title
        const cleanTitle = title.trim();

        // Reject if either is empty after trimming (catches "   ")
        if (!cleanCode || !cleanTitle) {
            // Same 400 and message as above
            return res.status(400).json({ error: "Course code and title are required" });
        }

        // Send the INSERT to Postgres and wait for its answer
        const result = await pool.query(
            `INSERT INTO courses
                -- the ten columns we are filling
                (user_id, code, title, instructor, room, color, schedule, grade_goal, credit_hours, current_grade)
             -- one placeholder per column, in the same order
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             -- send back the row that was just created
             RETURNING *`,
            // Values for $1..$10 in order; user_id comes from the verified token, never the body
            [req.userId, cleanCode, cleanTitle, instructor, room, color, schedule, gradeGoal, creditHours, currentGrade]
        );

        // 201 = created; rows[0] is the new row; formatCourse renames its fields
        return res.status(201).json({ course: formatCourse(result.rows[0]) });
    // If anything above crashed, we land here with the error
    } catch (error) {
        // Print the real error in YOUR terminal so you can debug it
        console.error("Error creating course:", error.message);
        // Tell the client only that something broke, never the details
        res.status(500).json({ error: "Server error" });
    }
};

// READ: GET /api/courses
export const getCourses = async (req, res) => {
    // Run the normal path
    try {
        // Ask Postgres for rows
        const result = await pool.query(
            // Only rows owned by this user, oldest first
            `SELECT * FROM courses WHERE user_id = $1 ORDER BY id`,
            // $1 is the logged-in user's id from the token
            [req.userId]
        );

        // Run every row through formatCourse to get a list of frontend-shaped courses
        const courses = result.rows.map(formatCourse);

        // 200 = OK; an empty list [] is a normal answer for a new user
        return res.status(200).json({ courses });
    // Handle crashes
    } catch (error) {
        // Log the real error for you
        console.error("Error getting courses:", error.message);
        // Generic message for the client
        res.status(500).json({ error: "Server error" });
    }
};

// UPDATE: PATCH /api/courses/:id
export const updateCourse = async (req, res) => {
    // Run the normal path
    try {
        // The :id from the URL is text, so convert it to a number
        const courseId = Number(req.params.id);

        // Reject ids like "abc" or "1.5" before they reach the database
        if (!Number.isInteger(courseId)) {
            // 400 = the id itself is malformed
            return res.status(400).json({ error: "Invalid course id" });
        }

        // Read the fields; any the client left out will be undefined
        const { code, title, instructor, room, color, schedule, gradeGoal, creditHours, currentGrade } = req.body;

        // If code was sent, it must be a non-blank string
        if (code !== undefined && (typeof code !== "string" || !code.trim())) {
            // Reject blank or wrong-type codes
            return res.status(400).json({ error: "Course code cannot be empty" });
        }

        // If title was sent, it must be a non-blank string
        if (title !== undefined && (typeof title !== "string" || !title.trim())) {
            // Reject blank or wrong-type titles
            return res.status(400).json({ error: "Course title cannot be empty" });
        }

        // Trim code only if it was sent; otherwise leave it undefined
        const cleanCode = code === undefined ? undefined : code.trim();
        // Trim title only if it was sent; otherwise leave it undefined
        const cleanTitle = title === undefined ? undefined : title.trim();

        // Send the UPDATE to Postgres
        const result = await pool.query(
            `UPDATE courses
             SET
                -- COALESCE(new, old) means: use the new value if one was sent, else keep the old one
                code = COALESCE($1, code),
                title = COALESCE($2, title),
                instructor = COALESCE($3, instructor),
                room = COALESCE($4, room),
                color = COALESCE($5, color),
                schedule = COALESCE($6, schedule),
                grade_goal = COALESCE($7, grade_goal),
                credit_hours = COALESCE($8, credit_hours),
                current_grade = COALESCE($9, current_grade)
             -- the row must match the id AND belong to this user (the ownership check)
             WHERE id = $10 AND user_id = $11
             -- send back the updated row
             RETURNING *`,
            // Values for $1..$11 in order
            [cleanCode, cleanTitle, instructor, room, color, schedule, gradeGoal, creditHours, currentGrade, courseId, req.userId]
        );

        // No row came back: wrong id, OR the course belongs to someone else
        if (result.rows.length === 0) {
            // 404 for both cases, so nobody can learn which ids exist
            return res.status(404).json({ error: "Course not found" });
        }

        // 200 = OK; send back the updated course in frontend shape
        return res.status(200).json({ course: formatCourse(result.rows[0]) });
    // Handle crashes
    } catch (error) {
        // Log the real error for you
        console.error("Error updating course:", error.message);
        // Generic message for the client
        res.status(500).json({ error: "Server error" });
    }
};

// DELETE: DELETE /api/courses/:id
export const deleteCourse = async (req, res) => {
    // Run the normal path
    try {
        // Convert the :id from the URL to a number
        const courseId = Number(req.params.id);

        // Reject malformed ids
        if (!Number.isInteger(courseId)) {
            // 400 = bad request
            return res.status(400).json({ error: "Invalid course id" });
        }

        // Send the DELETE to Postgres
        const result = await pool.query(
            // Delete only if the id matches AND the course belongs to this user; return the id
            `DELETE FROM courses WHERE id = $1 AND user_id = $2 RETURNING id`,
            // $1 is the course id, $2 is the logged-in user
            [courseId, req.userId]
        );

        // Nothing was deleted: wrong id or not yours
        if (result.rows.length === 0) {
            // Same 404 as update, for the same reason
            return res.status(404).json({ error: "Course not found" });
        }

        // 200 = OK; a short confirmation message
        return res.status(200).json({ message: "Course deleted" });
    // Handle crashes
    } catch (error) {
        // Log the real error for you
        console.error("Error deleting course:", error.message);
        // Generic message for the client
        res.status(500).json({ error: "Server error" });
    }
};