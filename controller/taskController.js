// Import the database pool so this file can send SQL to Postgres
import pool from "../config/db.js";

// The columns we read back; due_date::text turns a DATE into plain "2026-07-26" text
const TASK_COLUMNS = `id, course_id, title, due_date::text AS due_date, priority, status, estimated_time, tags`;

// Allowed priority words, kept in one place
const PRIORITIES = ["low", "medium", "high"];
// Allowed status words, kept in one place
const STATUSES = ["todo", "in_progress", "completed"];

// Helper: turns one database row into the shape the frontend expects
const formatTask = (row) => ({
    // The id Postgres generated
    id: row.id,
    // Database course_id becomes the frontend's courseId
    courseId: row.course_id,
    // Plain fields pass straight through
    title: row.title,
    // Database due_date becomes dueDate (already plain text thanks to ::text)
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    // Database estimated_time becomes estimatedTime
    estimatedTime: row.estimated_time,
    // A Postgres list arrives as a JavaScript array
    tags: row.tags
});

// Helper: true only if this course exists AND belongs to this user
const courseBelongsToUser = async (courseId, userId) => {
    // Look for a course that matches BOTH the id and the owner
    const result = await pool.query(
        `SELECT id FROM courses WHERE id = $1 AND user_id = $2`,
        // $1 is the course id, $2 is the logged-in user
        [courseId, userId]
    );
    // One row means yes; zero rows means missing or someone else's
    return result.rows.length > 0;
};

// Helper: checks the optional fields; returns an error message, or null if all is fine
const validateOptionalFields = ({ dueDate, priority, status, tags }) => {
    // If priority was sent, it must be one of the allowed words
    if (priority !== undefined && !PRIORITIES.includes(priority)) {
        // Message the frontend can show
        return "Priority must be low, medium or high";
    }
    // If status was sent, it must be one of the allowed words
    if (status !== undefined && !STATUSES.includes(status)) {
        return "Status must be todo, in_progress or completed";
    }
    // If dueDate was sent, it must be text shaped like 2026-07-26
    if (dueDate !== undefined && !(typeof dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
        return "Due date must look like 2026-07-26";
    }
    // If tags was sent, it must be a list where every item is text
    if (tags !== undefined && !(Array.isArray(tags) && tags.every((tag) => typeof tag === "string"))) {
        return "Tags must be a list of text";
    }
    // Nothing wrong found
    return null;
};

// CREATE: POST /api/tasks
export const createTask = async (req, res) => {
    // Run the normal path; a crash jumps to the catch below
    try {
        // Read the fields from the JSON body
        const { title, courseId, dueDate, priority, status, estimatedTime, tags } = req.body;

        // Title must be text and not blank
        if (typeof title !== "string" || !title.trim()) {
            // 400 = bad request; return stops the function
            return res.status(400).json({ error: "Task title is required" });
        }
        // Remove spaces from both ends of the title
        const cleanTitle = title.trim();

        // The URL/body may send the id as text, so convert it to a number
        const numericCourseId = Number(courseId);
        // It must be a whole number (a missing courseId becomes NaN and fails here)
        if (!Number.isInteger(numericCourseId)) {
            return res.status(400).json({ error: "A valid courseId is required" });
        }

        // Check the optional fields before touching the database
        const validationError = validateOptionalFields(req.body);
        // If one is wrong, stop with a 400
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        // The course must exist AND be yours
        if (!(await courseBelongsToUser(numericCourseId, req.userId))) {
            // Same 404 for "missing" and "not yours", so ids can't be probed
            return res.status(404).json({ error: "Course not found" });
        }

        // Send the INSERT to Postgres
        const result = await pool.query(
            `INSERT INTO tasks
                -- the eight columns we fill
                (user_id, course_id, title, due_date, priority, status, estimated_time, tags)
             -- one placeholder per column, in the same order
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             -- send back the new row using our column list
             RETURNING ${TASK_COLUMNS}`,
            // Values in order; user_id comes from the token; status and tags get defaults here
            [req.userId, numericCourseId, cleanTitle, dueDate, priority, status || "todo", estimatedTime, tags || []]
        );

        // 201 = created; send the new task in frontend shape
        return res.status(201).json({ task: formatTask(result.rows[0]) });
    // If anything above crashed, land here
    } catch (error) {
        // Real error goes to your terminal
        console.error("Error creating task:", error.message);
        // Vague message goes to the client
        res.status(500).json({ error: "Server error" });
    }
};

// READ: GET /api/tasks
export const getTasks = async (req, res) => {
    try {
        // Ask Postgres for this user's tasks only
        const result = await pool.query(
            `SELECT ${TASK_COLUMNS} FROM tasks WHERE user_id = $1 ORDER BY id`,
            // $1 is the logged-in user's id from the token
            [req.userId]
        );
        // Convert every row to frontend shape
        const tasks = result.rows.map(formatTask);
        // 200 = OK; an empty list is a normal answer
        return res.status(200).json({ tasks });
    } catch (error) {
        console.error("Error getting tasks:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};

// UPDATE: PATCH /api/tasks/:id (also used to change status)
export const updateTask = async (req, res) => {
    try {
        // The :id in the URL is text; convert it to a number
        const taskId = Number(req.params.id);
        // Reject ids like "abc" before they reach the database
        if (!Number.isInteger(taskId)) {
            return res.status(400).json({ error: "Invalid task id" });
        }

        // Read the fields; any the client left out are undefined
        const { title, courseId, dueDate, priority, status, estimatedTime, tags } = req.body;

        // If a title was sent, it must be non-blank text
        if (title !== undefined && (typeof title !== "string" || !title.trim())) {
            return res.status(400).json({ error: "Task title cannot be empty" });
        }
        // Trim the title only if it was sent
        const cleanTitle = title === undefined ? undefined : title.trim();

        // Check the optional fields before touching the database
        const validationError = validateOptionalFields(req.body);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        // Stays undefined unless the client is moving the task to another course
        let numericCourseId;
        // Only run these checks if a courseId was sent
        if (courseId !== undefined) {
            // Convert to a number
            numericCourseId = Number(courseId);
            // It must be a whole number
            if (!Number.isInteger(numericCourseId)) {
                return res.status(400).json({ error: "A valid courseId is required" });
            }
            // The NEW course must also be yours
            if (!(await courseBelongsToUser(numericCourseId, req.userId))) {
                return res.status(404).json({ error: "Course not found" });
            }
        }

        // Send the UPDATE to Postgres
        const result = await pool.query(
            `UPDATE tasks
             SET
                -- COALESCE(new, old): use the new value if one was sent, otherwise keep the old one
                title = COALESCE($1, title),
                course_id = COALESCE($2, course_id),
                due_date = COALESCE($3, due_date),
                priority = COALESCE($4, priority),
                status = COALESCE($5, status),
                estimated_time = COALESCE($6, estimated_time),
                tags = COALESCE($7, tags)
             -- the task must match the id AND belong to this user (the ownership check)
             WHERE id = $8 AND user_id = $9
             -- send back the updated row
             RETURNING ${TASK_COLUMNS}`,
            // Values for $1..$9 in order
            [cleanTitle, numericCourseId, dueDate, priority, status, estimatedTime, tags, taskId, req.userId]
        );

        // No row came back: wrong id, or someone else's task
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Task not found" });
        }

        // 200 = OK; send the updated task
        return res.status(200).json({ task: formatTask(result.rows[0]) });
    } catch (error) {
        console.error("Error updating task:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};

// DELETE: DELETE /api/tasks/:id
export const deleteTask = async (req, res) => {
    try {
        // Convert the :id from the URL to a number
        const taskId = Number(req.params.id);
        // Reject malformed ids
        if (!Number.isInteger(taskId)) {
            return res.status(400).json({ error: "Invalid task id" });
        }

        // Delete only if the id matches AND the task is yours; return the id
        const result = await pool.query(
            `DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id`,
            // $1 is the task id, $2 is the logged-in user
            [taskId, req.userId]
        );

        // Nothing deleted: wrong id or not yours
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Task not found" });
        }

        // 200 = OK; a short confirmation
        return res.status(200).json({ message: "Task deleted" });
    } catch (error) {
        console.error("Error deleting task:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};