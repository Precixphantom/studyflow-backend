// Import the database pool so this file can send SQL to Postgres
import pool from "../config/db.js";
// Import the shared course ownership check
import { courseBelongsToUser } from "../utils/courseOwnership.js";

// Exam columns we read back; to_char gives "2026-07-31T10:00:00" as plain text, not a JavaScript Date
const EXAM_COLUMNS = `id, course_id, title, to_char(exam_date, 'YYYY-MM-DD"T"HH24:MI:SS') AS exam_date, location, weight, target_grade`;
// Topic columns we read back
const TOPIC_COLUMNS = `id, exam_id, topic, completed`;

// Accepts 2026-07-31, 2026-07-31T10:00 or 2026-07-31T10:00:00 (a trailing Z or offset is rejected)
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
// The most checklist topics one exam may be created with
const MAX_TOPICS = 100;

// Keeps null as null, otherwise converts text like "25" into the number 25
const toNumberOrNull = (value) => (value === null ? null : Number(value));

// True only for a real, finite number (rejects text, NaN and Infinity)
const isValidNumber = (value) => typeof value === "number" && Number.isFinite(value);

// Turns one topic row into the shape the frontend expects
const formatTopic = (row) => ({
    // The id Postgres generated
    id: row.id,
    // The topic text
    topic: row.topic,
    // true or false
    completed: row.completed
});

// Turns one exam row plus its topics into the shape the frontend expects
const formatExam = (row, topics) => ({
    // The id Postgres generated
    id: row.id,
    // Database course_id becomes courseId
    courseId: row.course_id,
    // Plain fields pass straight through
    title: row.title,
    // Database exam_date becomes examDate (already plain text thanks to to_char)
    examDate: row.exam_date,
    location: row.location,
    // NUMERIC arrives as text, so convert it to a real number (or null)
    weight: toNumberOrNull(row.weight),
    // Database target_grade becomes targetGrade
    targetGrade: row.target_grade,
    // The checklist lives inside the exam, as the contract says
    checklist: topics
});

// Gets the topics for several exams in ONE query and groups them by exam id
const getTopicsByExamIds = async (examIds) => {
    // Nothing to look up, so skip the database
    if (examIds.length === 0) {
        return {};
    }
    // Fetch every topic whose exam id is in the list
    const result = await pool.query(
        `SELECT ${TOPIC_COLUMNS} FROM exam_topics WHERE exam_id = ANY($1::int[]) ORDER BY id`,
        // $1 is the whole list of exam ids
        [examIds]
    );
    // Will become { examId: [topic, topic, ...] }
    const grouped = {};
    // Go through every topic row
    for (const row of result.rows) {
        // Start a list for this exam if there is none yet
        if (!grouped[row.exam_id]) {
            grouped[row.exam_id] = [];
        }
        // Add the formatted topic to its exam's list
        grouped[row.exam_id].push(formatTopic(row));
    }
    // Hand back the grouped topics
    return grouped;
};

// True only if this exam exists AND belongs to this user
const examBelongsToUser = async (examId, userId) => {
    // Look for an exam matching BOTH the id and the owner
    const result = await pool.query(
        `SELECT id FROM exams WHERE id = $1 AND user_id = $2`,
        // $1 is the exam id, $2 is the logged-in user
        [examId, userId]
    );
    // One row means yes; zero rows means missing or someone else's
    return result.rows.length > 0;
};

// Checks the optional fields; returns an error message, or null if all is fine
const validateOptionalFields = ({ examDate, location, weight, targetGrade }) => {
    // "!= null" is true when a value is neither null nor undefined, meaning it was really sent
    if (examDate != null && !(typeof examDate === "string" && DATE_PATTERN.test(examDate))) {
        // Message the frontend can show
        return "examDate must look like 2026-07-31 or 2026-07-31T10:00:00, with no Z at the end";
    }
    // Location must be text if sent
    if (location != null && typeof location !== "string") {
        return "Location must be text";
    }
    // Weight must be a real number from 0 to 100 if sent
    if (weight != null && (!isValidNumber(weight) || weight < 0 || weight > 100)) {
        return "Weight must be a number from 0 to 100";
    }
    // Target grade must be text if sent
    if (targetGrade != null && typeof targetGrade !== "string") {
        return "Target grade must be text";
    }
    // Nothing wrong found
    return null;
};

// Checks the checklist sent when creating an exam; returns an error message, or null if fine
const validateChecklist = (checklist) => {
    // Not sent at all is fine
    if (checklist == null) {
        return null;
    }
    // It must be a list that is not absurdly long
    if (!Array.isArray(checklist) || checklist.length > MAX_TOPICS) {
        return `Checklist must be a list of at most ${MAX_TOPICS} topics`;
    }
    // Check every item in the list
    for (const item of checklist) {
        // Each item must be an object with a non-blank text topic of at most 255 characters
        const topicOk = item !== null && typeof item === "object" && typeof item.topic === "string" && item.topic.trim() !== "" && item.topic.trim().length <= 255;
        // If sent, completed must be true or false
        const completedOk = item !== null && typeof item === "object" && (item.completed == null || typeof item.completed === "boolean");
        // Reject the whole checklist if any item is wrong
        if (!topicOk || !completedOk) {
            return "Each checklist item needs a text topic, and completed must be true or false";
        }
    }
    // Everything looks fine
    return null;
};

// Postgres codes for "date out of range" (like 2026-99-99) and "bad date format"
const isBadDateError = (error) => error.code === "22008" || error.code === "22007";

// CREATE: POST /api/exams
export const createExam = async (req, res) => {
    // Run the normal path; a crash jumps to the catch below
    try {
        // Read the fields from the JSON body
        const { title, courseId, examDate, location, weight, targetGrade, checklist } = req.body;

        // Title must be text and not blank
        if (typeof title !== "string" || !title.trim()) {
            // 400 = bad request; return stops the function
            return res.status(400).json({ error: "Exam title is required" });
        }
        // Remove spaces from both ends of the title
        const cleanTitle = title.trim();

        // courseId must already be a whole number (text, null and true are all rejected)
        if (!Number.isInteger(courseId)) {
            return res.status(400).json({ error: "courseId must be a whole number" });
        }

        // Check the optional fields before touching the database
        const validationError = validateOptionalFields(req.body) || validateChecklist(checklist);
        // If one is wrong, stop with a 400
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        // The course must exist AND be yours
        if (!(await courseBelongsToUser(courseId, req.userId))) {
            // Same 404 for "missing" and "not yours", so ids can't be probed
            return res.status(404).json({ error: "Course not found" });
        }

        // Build a clean list of topics: trimmed text, and completed forced to true or false
        const cleanChecklist = (checklist || []).map((item) => ({
            topic: item.topic.trim(),
            completed: item.completed === true
        }));

        // Take ONE connection from the pool, because a transaction must stay on a single connection
        const client = await pool.connect();
        // Run the transaction; any crash is caught further down
        try {
            // Start the transaction: nothing is permanent until COMMIT
            await client.query("BEGIN");

            // Insert the exam row
            const examResult = await client.query(
                `INSERT INTO exams
                    -- the seven columns we fill
                    (user_id, course_id, title, exam_date, location, weight, target_grade)
                 -- one placeholder per column, in the same order
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 -- send back the new row using our column list
                 RETURNING ${EXAM_COLUMNS}`,
                // Values in order; user_id comes from the token, never the body
                [req.userId, courseId, cleanTitle, examDate, location, weight, targetGrade]
            );
            // The new exam row is the first (and only) row
            const exam = examResult.rows[0];

            // Will collect the topic rows we create
            const topics = [];
            // Insert each topic as its own row
            for (const item of cleanChecklist) {
                // One INSERT per topic, linked to the new exam's id
                const topicResult = await client.query(
                    `INSERT INTO exam_topics (exam_id, topic, completed) VALUES ($1, $2, $3) RETURNING ${TOPIC_COLUMNS}`,
                    [exam.id, item.topic, item.completed]
                );
                // Keep the formatted topic for the response
                topics.push(formatTopic(topicResult.rows[0]));
            }

            // Everything worked, so make it permanent
            await client.query("COMMIT");

            // 201 = created; send the exam with its checklist inside
            return res.status(201).json({ exam: formatExam(exam, topics) });
        // If any step above failed, undo everything and pass the error on
        } catch (error) {
            // Throw away every change since BEGIN
            await client.query("ROLLBACK");
            // Hand the error to the outer catch
            throw error;
        // Runs whether we succeeded or failed
        } finally {
            // Give the connection back to the pool, or it leaks
            client.release();
        }
    // Outer catch: handles everything that went wrong above
    } catch (error) {
        // A date like 2026-99-99 is the client's mistake, so answer 400, not 500
        if (isBadDateError(error)) {
            return res.status(400).json({ error: "examDate is not a real date" });
        }
        // Real error goes to your terminal
        console.error("Error creating exam:", error.message);
        // Vague message goes to the client
        res.status(500).json({ error: "Server error" });
    }
};

// READ: GET /api/exams
export const getExams = async (req, res) => {
    try {
        // Ask Postgres for this user's exams only
        const examResult = await pool.query(
            `SELECT ${EXAM_COLUMNS} FROM exams WHERE user_id = $1 ORDER BY id`,
            // $1 is the logged-in user's id from the token
            [req.userId]
        );
        // Collect just the exam ids
        const examIds = examResult.rows.map((row) => row.id);
        // Fetch the topics for ALL those exams in a single query
        const topicsByExam = await getTopicsByExamIds(examIds);
        // Build each exam with its own topics (or an empty list)
        const exams = examResult.rows.map((row) => formatExam(row, topicsByExam[row.id] || []));
        // 200 = OK; an empty list is a normal answer
        return res.status(200).json({ exams });
    } catch (error) {
        console.error("Error getting exams:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};

// UPDATE: PATCH /api/exams/:id (the checklist is NOT changed here)
export const updateExam = async (req, res) => {
    try {
        // The :id in the URL is text; convert it to a number
        const examId = Number(req.params.id);
        // Reject ids like "abc" before they reach the database
        if (!Number.isInteger(examId)) {
            return res.status(400).json({ error: "Invalid exam id" });
        }

        // Read the fields; any the client left out are undefined (checklist is deliberately not read)
        const { title, courseId, examDate, location, weight, targetGrade } = req.body;

        // If a title was sent, it must be non-blank text
        if (title != null && (typeof title !== "string" || !title.trim())) {
            return res.status(400).json({ error: "Exam title cannot be empty" });
        }
        // Trim the title only if it was sent; otherwise leave it undefined
        const cleanTitle = title == null ? undefined : title.trim();

        // Check the optional fields before touching the database
        const validationError = validateOptionalFields(req.body);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        // Only run these checks if the client is moving the exam to another course
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
            `UPDATE exams
             SET
                -- COALESCE(new, old): use the new value if one was sent, otherwise keep the old one
                title = COALESCE($1, title),
                course_id = COALESCE($2, course_id),
                exam_date = COALESCE($3, exam_date),
                location = COALESCE($4, location),
                weight = COALESCE($5, weight),
                target_grade = COALESCE($6, target_grade)
             -- the row must match the id AND belong to this user (the ownership check)
             WHERE id = $7 AND user_id = $8
             -- send back the updated row
             RETURNING ${EXAM_COLUMNS}`,
            // Values for $1..$8 in order
            [cleanTitle, courseId, examDate, location, weight, targetGrade, examId, req.userId]
        );

        // No row came back: wrong id, or someone else's exam
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Exam not found" });
        }

        // Fetch this exam's topics so the response still has its checklist
        const topicsByExam = await getTopicsByExamIds([examId]);
        // 200 = OK; send the updated exam with its checklist inside
        return res.status(200).json({ exam: formatExam(result.rows[0], topicsByExam[examId] || []) });
    } catch (error) {
        // A date like 2026-99-99 is the client's mistake, so answer 400, not 500
        if (isBadDateError(error)) {
            return res.status(400).json({ error: "examDate is not a real date" });
        }
        console.error("Error updating exam:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};

// DELETE: DELETE /api/exams/:id
export const deleteExam = async (req, res) => {
    try {
        // Convert the :id from the URL to a number
        const examId = Number(req.params.id);
        // Reject malformed ids
        if (!Number.isInteger(examId)) {
            return res.status(400).json({ error: "Invalid exam id" });
        }

        // Delete only if the id matches AND the exam is yours; its topics go with it automatically
        const result = await pool.query(
            `DELETE FROM exams WHERE id = $1 AND user_id = $2 RETURNING id`,
            // $1 is the exam id, $2 is the logged-in user
            [examId, req.userId]
        );

        // Nothing deleted: wrong id or not yours
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Exam not found" });
        }

        // 200 = OK; a short confirmation
        return res.status(200).json({ message: "Exam deleted" });
    } catch (error) {
        console.error("Error deleting exam:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};

// TOGGLE: PATCH /api/exams/:examId/checklist/:topicId
export const toggleChecklistTopic = async (req, res) => {
    try {
        // Convert both ids from the URL to numbers
        const examId = Number(req.params.examId);
        const topicId = Number(req.params.topicId);
        // Reject malformed ids
        if (!Number.isInteger(examId) || !Number.isInteger(topicId)) {
            return res.status(400).json({ error: "Invalid exam or topic id" });
        }

        // The body may be missing entirely, so fall back to an empty object
        const { completed } = req.body || {};
        // If completed was sent, it must be exactly true or false
        if (completed != null && typeof completed !== "boolean") {
            return res.status(400).json({ error: "completed must be true or false" });
        }

        // The exam must exist AND be yours
        if (!(await examBelongsToUser(examId, req.userId))) {
            return res.status(404).json({ error: "Exam not found" });
        }

        // Update the one topic
        const result = await pool.query(
            `UPDATE exam_topics
             -- if a value was sent, set it; otherwise flip the current value
             SET completed = COALESCE($1, NOT completed)
             -- the topic must match its id AND belong to that exam
             WHERE id = $2 AND exam_id = $3
             -- send back the updated topic
             RETURNING ${TOPIC_COLUMNS}`,
            // $1 is the value (or null to flip), $2 the topic id, $3 the exam id
            [completed, topicId, examId]
        );

        // No row: that topic is not in that exam
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Topic not found" });
        }

        // 200 = OK; send back the updated topic
        return res.status(200).json({ topic: formatTopic(result.rows[0]) });
    } catch (error) {
        console.error("Error toggling topic:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};