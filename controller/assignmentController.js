// Import the database pool so this file can send SQL to Postgres
import pool from "../config/db.js";
// Import the shared ownership check
import { courseBelongsToUser } from "../utils/courseOwnership.js";

// The columns we read back; due_date::text gives plain "2026-07-29" text
const ASSIGNMENT_COLUMNS = `id, course_id, title, due_date::text AS due_date, status, priority, score, max_score, weight, description`;

// Allowed priority words, kept in one place
const PRIORITIES = ["low", "medium", "high"];
// Allowed status words, kept in one place
const STATUSES = ["not_started", "in_progress", "submitted", "graded"];

// Helper: keeps null as null, otherwise converts text like "85.5" into the number 85.5
const toNumberOrNull = (value) => (value === null ? null : Number(value));

// Helper: true only for a real, finite number (rejects text, NaN and Infinity)
const isValidNumber = (value) => typeof value === "number" && Number.isFinite(value);

// Helper: turns one database row into the shape the frontend expects
const formatAssignment = (row) => ({
    // The id Postgres generated
    id: row.id,
    // Database course_id becomes the frontend's courseId
    courseId: row.course_id,
    // Plain fields pass straight through
    title: row.title,
    // Database due_date becomes dueDate
    dueDate: row.due_date,
    status: row.status,
    priority: row.priority,
    // NUMERIC arrives as text, so convert each one to a real number (or null)
    score: toNumberOrNull(row.score),
    // Database max_score becomes maxScore
    maxScore: toNumberOrNull(row.max_score),
    weight: toNumberOrNull(row.weight),
    description: row.description
});

// Helper: checks the optional fields; returns an error message, or null if all is fine
const validateOptionalFields = ({ dueDate, status, priority, score, maxScore, weight, description }) => {
    // "!= null" is true when a value is neither null nor undefined, meaning it was really sent
    if (status != null && !STATUSES.includes(status)) {
        // Message the frontend can show
        return "Status must be not_started, in_progress, submitted or graded";
    }
    // Priority must be one of the allowed words if sent
    if (priority != null && !PRIORITIES.includes(priority)) {
        return "Priority must be low, medium or high";
    }
    // Due date must be text shaped like 2026-07-29 if sent
    if (dueDate != null && !(typeof dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
        return "Due date must look like 2026-07-29";
    }
    // Score must be a real number, 0 or more, if sent
    if (score != null && (!isValidNumber(score) || score < 0)) {
        return "Score must be a number, 0 or more";
    }
    // Max score must be a real number above 0 if sent
    if (maxScore != null && (!isValidNumber(maxScore) || maxScore <= 0)) {
        return "Max score must be a number above 0";
    }
    // Weight must be a real number from 0 to 100 if sent
    if (weight != null && (!isValidNumber(weight) || weight < 0 || weight > 100)) {
        return "Weight must be a number from 0 to 100";
    }
    // Description must be text if sent
    if (description != null && typeof description !== "string") {
        return "Description must be text";
    }
    // Nothing wrong found
    return null;
};

// CREATE: POST /api/assignments
export const createAssignment = async (req, res) => {
    // Run the normal path; a crash jumps to the catch below
    try {
        // Read the fields from the JSON body
        const { title, courseId, dueDate, status, priority, score, maxScore, weight, description } = req.body;

        // Title must be text and not blank
        if (typeof title !== "string" || !title.trim()) {
            // 400 = bad request; return stops the function
            return res.status(400).json({ error: "Assignment title is required" });
        }
        // Remove spaces from both ends of the title
        const cleanTitle = title.trim();

        // courseId must already be a whole number (text, null and true are all rejected)
        if (!Number.isInteger(courseId)) {
            return res.status(400).json({ error: "courseId must be a whole number" });
        }

        // Check the optional fields before touching the database
        const validationError = validateOptionalFields(req.body);
        // If one is wrong, stop with a 400
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        // The course must exist AND be yours
        if (!(await courseBelongsToUser(courseId, req.userId))) {
            // Same 404 for "missing" and "not yours", so ids can't be probed
            return res.status(404).json({ error: "Course not found" });
        }

        // Send the INSERT to Postgres
        const result = await pool.query(
            `INSERT INTO assignments
                -- the ten columns we fill
                (user_id, course_id, title, due_date, status, priority, score, max_score, weight, description)
             -- one placeholder per column, in the same order
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             -- send back the new row using our column list
             RETURNING ${ASSIGNMENT_COLUMNS}`,
            // Values in order; user_id comes from the token; a missing status becomes not_started
            [req.userId, courseId, cleanTitle, dueDate, status || "not_started", priority, score, maxScore, weight, description]
        );

        // 201 = created; send the new assignment in frontend shape
        return res.status(201).json({ assignment: formatAssignment(result.rows[0]) });
    // If anything above crashed, land here
    } catch (error) {
        // Real error goes to your terminal
        console.error("Error creating assignment:", error.message);
        // Vague message goes to the client
        res.status(500).json({ error: "Server error" });
    }
};

// READ: GET /api/assignments
export const getAssignments = async (req, res) => {
    try {
        // Ask Postgres for this user's assignments only
        const result = await pool.query(
            `SELECT ${ASSIGNMENT_COLUMNS} FROM assignments WHERE user_id = $1 ORDER BY id`,
            // $1 is the logged-in user's id from the token
            [req.userId]
        );
        // Convert every row to frontend shape
        const assignments = result.rows.map(formatAssignment);
        // 200 = OK; an empty list is a normal answer
        return res.status(200).json({ assignments });
    } catch (error) {
        console.error("Error getting assignments:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};

// UPDATE: PATCH /api/assignments/:id (also used to advance the status)
export const updateAssignment = async (req, res) => {
    try {
        // The :id in the URL is text; convert it to a number
        const assignmentId = Number(req.params.id);
        // Reject ids like "abc" before they reach the database
        if (!Number.isInteger(assignmentId)) {
            return res.status(400).json({ error: "Invalid assignment id" });
        }

        // Read the fields; any the client left out are undefined
        const { title, courseId, dueDate, status, priority, score, maxScore, weight, description } = req.body;

        // If a title was sent, it must be non-blank text
        if (title != null && (typeof title !== "string" || !title.trim())) {
            return res.status(400).json({ error: "Assignment title cannot be empty" });
        }
        // Trim the title only if it was sent; otherwise leave it undefined
        const cleanTitle = title == null ? undefined : title.trim();

        // Check the optional fields before touching the database
        const validationError = validateOptionalFields(req.body);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        // Only run these checks if the client is moving the assignment to another course
        if (courseId != null) {
            // It must be a whole number
            if (!Number.isInteger(courseId)) {
                return res.status(400).json({ error: "courseId must be a whole number" });
            }
            // The NEW course must also be yours
            if (!(await courseBelongsToUser(courseId, req.userId))) {
                return res.status(404).json({ error: "Course not found" });
            }
        }

        // Send the UPDATE to Postgres
        const result = await pool.query(
            `UPDATE assignments
             SET
                -- COALESCE(new, old): use the new value if one was sent, otherwise keep the old one
                title = COALESCE($1, title),
                course_id = COALESCE($2, course_id),
                due_date = COALESCE($3, due_date),
                status = COALESCE($4, status),
                priority = COALESCE($5, priority),
                score = COALESCE($6, score),
                max_score = COALESCE($7, max_score),
                weight = COALESCE($8, weight),
                description = COALESCE($9, description)
             -- the row must match the id AND belong to this user (the ownership check)
             WHERE id = $10 AND user_id = $11
             -- send back the updated row
             RETURNING ${ASSIGNMENT_COLUMNS}`,
            // Values for $1..$11 in order
            [cleanTitle, courseId, dueDate, status, priority, score, maxScore, weight, description, assignmentId, req.userId]
        );

        // No row came back: wrong id, or someone else's assignment
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Assignment not found" });
        }

        // 200 = OK; send the updated assignment
        return res.status(200).json({ assignment: formatAssignment(result.rows[0]) });
    } catch (error) {
        console.error("Error updating assignment:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};

// DELETE: DELETE /api/assignments/:id
export const deleteAssignment = async (req, res) => {
    try {
        // Convert the :id from the URL to a number
        const assignmentId = Number(req.params.id);
        // Reject malformed ids
        if (!Number.isInteger(assignmentId)) {
            return res.status(400).json({ error: "Invalid assignment id" });
        }

        // Delete only if the id matches AND the assignment is yours; return the id
        const result = await pool.query(
            `DELETE FROM assignments WHERE id = $1 AND user_id = $2 RETURNING id`,
            // $1 is the assignment id, $2 is the logged-in user
            [assignmentId, req.userId]
        );

        // Nothing deleted: wrong id or not yours
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Assignment not found" });
        }

        // 200 = OK; a short confirmation
        return res.status(200).json({ message: "Assignment deleted" });
    } catch (error) {
        console.error("Error deleting assignment:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};