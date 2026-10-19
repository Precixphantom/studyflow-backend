// Import the database pool so this file can send SQL to Postgres
import pool from "../config/db.js";

// Returns true only if this course exists AND belongs to this user
export const courseBelongsToUser = async (courseId, userId) => {
    // Look for a course that matches BOTH the id and the owner
    const result = await pool.query(
        `SELECT id FROM courses WHERE id = $1 AND user_id = $2`,
        // $1 is the course id, $2 is the logged-in user
        [courseId, userId]
    );
    // One row means yes; zero rows means it is missing or someone else's
    return result.rows.length > 0;
};