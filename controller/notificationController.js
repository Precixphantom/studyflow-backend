// Import the database pool so this file can send SQL to Postgres
import pool from "../config/db.js";

// The timezone that decides what "today" and "tomorrow" mean (all users are assumed to be here)
const APP_TIMEZONE = "Africa/Lagos";
// The most notifications one list request returns
const LIST_LIMIT = 50;
// The columns we read back
const NOTIFICATION_COLUMNS = `id, type, title, message, is_read, created_at`;

// Turns one database row into the shape the frontend expects
const formatNotification = (row) => ({
    // The id Postgres generated
    id: row.id,
    // Plain fields pass straight through
    title: row.title,
    message: row.message,
    type: row.type,
    // created_at is a Date object; toISOString makes UTC text ending in Z, like "2026-10-23T09:30:00.000Z"
    timestamp: row.created_at.toISOString(),
    // Database is_read becomes the frontend's read
    read: row.is_read
});

// Builds "1 topic" or "3 topics"
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Saves a notification, unless this user already has one with the same dedupe key
const saveIfNew = async (userId, type, title, message, dedupeKey) => {
    // Send the INSERT to Postgres
    await pool.query(
        `INSERT INTO notifications (user_id, type, title, message, dedupe_key)
         VALUES ($1, $2, $3, $4, $5)
         -- if this user already has this key, quietly do nothing (this is what stops duplicates)
         ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
        // Values in order
        [userId, type, title, message, dedupeKey]
    );
};

// Creates exam alerts for exams happening within the next 7 days
const generateExamNotifications = async (userId) => {
    // Find this user's upcoming exams, with their course code and checklist counts
    const result = await pool.query(
        `SELECT e.id, e.title, e.exam_date::date::text AS exam_day, c.code AS course_code,
                -- hours from now (in Lagos time) until the exam
                EXTRACT(EPOCH FROM (e.exam_date - (NOW() AT TIME ZONE '${APP_TIMEZONE}'))) / 3600 AS hours_left,
                -- how many topics the checklist has in total
                (SELECT COUNT(*) FROM exam_topics t WHERE t.exam_id = e.id) AS topics_total,
                -- how many topics are not ticked yet
                (SELECT COUNT(*) FROM exam_topics t WHERE t.exam_id = e.id AND t.completed = FALSE) AS topics_left
         FROM exams e
         JOIN courses c ON c.id = e.course_id
         WHERE e.user_id = $1
           AND e.exam_date IS NOT NULL
           -- still in the future
           AND e.exam_date > (NOW() AT TIME ZONE '${APP_TIMEZONE}')
           -- and within the next 7 days
           AND e.exam_date <= (NOW() AT TIME ZONE '${APP_TIMEZONE}') + INTERVAL '7 days'`,
        // $1 is the logged-in user's id
        [userId]
    );

    // Go through each upcoming exam
    for (const row of result.rows) {
        // The counts arrive as text, so convert them to numbers
        const hoursLeft = Number(row.hours_left);
        const topicsTotal = Number(row.topics_total);
        const topicsLeft = Number(row.topics_left);
        // Within 24 hours it is the "final reminder"; otherwise it is the "7 day" alert
        const milestone = hoursLeft <= 24 ? "1d" : "7d";
        // The wording for when it happens
        const when = hoursLeft <= 24 ? "in less than 24 hours" : `in ${plural(Math.ceil(hoursLeft / 24), "day")}`;
        // The checklist sentence: nothing if there is no checklist, a celebration if it is done, a count otherwise
        const checklistNote = topicsTotal === 0 ? "" : topicsLeft === 0 ? " Your study checklist is complete." : ` ${plural(topicsLeft, "topic")} still to study.`;
        // Save it; the key includes the exam id, the milestone and the exam's date, so moving the exam allows a fresh alert
        await saveIfNew(userId, "exam", `Exam alert: ${row.course_code}`, `${row.title} is ${when}.${checklistNote}`, `exam:${row.id}:${milestone}:${row.exam_day}`);
    }
};

// Creates assignment alerts for ones due tomorrow, due today, or overdue by up to 3 days
const generateAssignmentNotifications = async (userId) => {
    // Find this user's unfinished assignments near their deadline
    const result = await pool.query(
        `SELECT a.id, a.title, a.due_date::text AS due_day, c.code AS course_code,
                -- whole days from today (Lagos date) until the due date; negative means overdue
                (a.due_date - (NOW() AT TIME ZONE '${APP_TIMEZONE}')::date) AS days_left
         FROM assignments a
         JOIN courses c ON c.id = a.course_id
         WHERE a.user_id = $1
           AND a.due_date IS NOT NULL
           -- not submitted and not graded
           AND a.status IN ('not_started', 'in_progress')
           -- due tomorrow (1), today (0), or up to 3 days ago (-1 to -3)
           AND (a.due_date - (NOW() AT TIME ZONE '${APP_TIMEZONE}')::date) BETWEEN -3 AND 1`,
        // $1 is the logged-in user's id
        [userId]
    );

    // Go through each assignment
    for (const row of result.rows) {
        // Convert the day count to a number
        const daysLeft = Number(row.days_left);
        // Decide which of the three situations this is
        const state = daysLeft === 1 ? "tomorrow" : daysLeft === 0 ? "today" : "overdue";
        // The headline
        const title = state === "overdue" ? "Assignment overdue" : `Assignment due ${state}`;
        // The sentence shown to the student
        const message = state === "overdue"
            ? `"${row.title}" for ${row.course_code} was due on ${row.due_day} and is not submitted yet.`
            : `"${row.title}" for ${row.course_code} is due ${state}.`;
        // Save it; the key includes the situation and the due date, so each situation alerts once
        await saveIfNew(userId, "assignment", title, message, `assignment:${row.id}:${state}:${row.due_day}`);
    }
};

// READ: GET /api/notifications
export const getNotifications = async (req, res) => {
    // Run the normal path
    try {
        // Generating alerts is a bonus step: if it fails we still return the list
        try {
            // Create any exam alerts that are due
            await generateExamNotifications(req.userId);
            // Create any assignment alerts that are due
            await generateAssignmentNotifications(req.userId);
        // If generation crashed, land here
        } catch (generationError) {
            // Log it for you, but do not fail the request
            console.error("Error generating notifications:", generationError.message);
        }

        // Fetch this user's newest notifications
        const result = await pool.query(
            `SELECT ${NOTIFICATION_COLUMNS} FROM notifications
             WHERE user_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2`,
            // $1 is the logged-in user, $2 is the limit
            [req.userId, LIST_LIMIT]
        );
        // Convert every row to frontend shape
        const notifications = result.rows.map(formatNotification);
        // 200 = OK; an empty list is a normal answer
        return res.status(200).json({ notifications });
    // Handle crashes in the main path
    } catch (error) {
        // Real error goes to your terminal
        console.error("Error getting notifications:", error.message);
        // Vague message goes to the client
        res.status(500).json({ error: "Server error" });
    }
};

// UPDATE: PATCH /api/notifications/:id (marks it read; send { read: false } to mark it unread again)
export const markNotificationRead = async (req, res) => {
    try {
        // The :id in the URL is text; convert it to a number
        const notificationId = Number(req.params.id);
        // Reject ids like "abc" before they reach the database
        if (!Number.isInteger(notificationId)) {
            return res.status(400).json({ error: "Invalid notification id" });
        }

        // The body may be missing entirely, so fall back to an empty object
        const { read } = req.body || {};
        // If read was sent, it must be exactly true or false
        if (read != null && typeof read !== "boolean") {
            return res.status(400).json({ error: "read must be true or false" });
        }

        // Send the UPDATE to Postgres
        const result = await pool.query(
            `UPDATE notifications
             -- use the value that was sent, otherwise mark it read
             SET is_read = COALESCE($1, TRUE)
             -- the row must match the id AND belong to this user (the ownership check)
             WHERE id = $2 AND user_id = $3
             -- send back the updated row
             RETURNING ${NOTIFICATION_COLUMNS}`,
            // $1 is the value (or null), $2 the notification id, $3 the logged-in user
            [read, notificationId, req.userId]
        );

        // No row came back: wrong id, or someone else's notification
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Notification not found" });
        }

        // 200 = OK; send back the updated notification
        return res.status(200).json({ notification: formatNotification(result.rows[0]) });
    } catch (error) {
        console.error("Error marking notification read:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};

// UPDATE: PATCH /api/notifications/read-all
export const markAllNotificationsRead = async (req, res) => {
    try {
        // Mark every unread notification of this user as read
        const result = await pool.query(
            `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
            // $1 is the logged-in user
            [req.userId]
        );
        // rowCount is how many rows changed; 200 = OK
        return res.status(200).json({ updated: result.rowCount });
    } catch (error) {
        console.error("Error marking all notifications read:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};