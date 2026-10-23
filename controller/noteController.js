// Import the database pool so this file can send SQL to Postgres
import pool from "../config/db.js";
// Import the shared course ownership check
import { courseBelongsToUser } from "../utils/courseOwnership.js";

// The columns we read back
const NOTE_COLUMNS = `id, course_id, title, tags, updated_at, favorite, category, content`;
// Longest allowed title, in characters
const MAX_TITLE = 255;
// Longest allowed category, in characters
const MAX_CATEGORY = 100;
// Longest allowed note body, in characters
const MAX_CONTENT = 100000;
// Most tags one note may have
const MAX_TAGS = 30;
// Longest allowed single tag, in characters
const MAX_TAG_LENGTH = 50;

// Trims text if it was sent; stays undefined if it was not
const trimOrUndefined = (value) => (value == null ? undefined : value.trim());

// True only for text that is not blank and not too long
const isValidTitle = (title) => typeof title === "string" && title.trim() !== "" && title.trim().length <= MAX_TITLE;

// Turns one database row into the shape the frontend expects
const formatNote = (row) => ({
    // The id Postgres generated
    id: row.id,
    // Database course_id becomes courseId
    courseId: row.course_id,
    // Plain fields pass straight through
    title: row.title,
    // A list of text, already an array
    tags: row.tags,
    // pg gives us a Date object; toISOString makes text like "2026-10-23T09:30:00.000Z"
    updatedAt: row.updated_at.toISOString(),
    favorite: row.favorite,
    category: row.category,
    content: row.content
});

// Checks the optional fields; returns an error message, or null if all is fine
const validateOptionalFields = ({ category, content, favorite, tags }) => {
    // "!= null" is true when a value is neither null nor undefined, meaning it was really sent
    if (category != null && (typeof category !== "string" || category.trim().length > MAX_CATEGORY)) {
        // Message the frontend can show
        return `Category must be text of at most ${MAX_CATEGORY} characters`;
    }
    // Content must be text and not enormous
    if (content != null && (typeof content !== "string" || content.length > MAX_CONTENT)) {
        return `Content must be text of at most ${MAX_CONTENT} characters`;
    }
    // Favorite must be exactly true or false
    if (favorite != null && typeof favorite !== "boolean") {
        return "favorite must be true or false";
    }
    // Tags: a short list where every item is non-blank text of limited length
    if (tags != null) {
        // All the rules in one yes-or-no value
        const tagsOk = Array.isArray(tags) && tags.length <= MAX_TAGS && tags.every((tag) => typeof tag === "string" && tag.trim() !== "" && tag.trim().length <= MAX_TAG_LENGTH);
        // If any rule fails, reject
        if (!tagsOk) {
            return `Tags must be a list of at most ${MAX_TAGS} items, each text of 1 to ${MAX_TAG_LENGTH} characters`;
        }
    }
    // Nothing wrong found
    return null;
};

// CREATE: POST /api/notes
export const createNote = async (req, res) => {
    // Run the normal path; a crash jumps to the catch below
    try {
        // Read the fields from the JSON body (updatedAt is deliberately NOT read: the server owns it)
        const { title, courseId, tags, favorite, category, content } = req.body;

        // Title must be non-blank text of limited length
        if (!isValidTitle(title)) {
            // 400 = bad request; return stops the function
            return res.status(400).json({ error: "Note title is required (1 to 255 characters)" });
        }

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

        // Trim every tag, or use an empty list if none were sent
        const cleanTags = tags == null ? [] : tags.map((tag) => tag.trim());

        // Send the INSERT to Postgres
        const result = await pool.query(
            `INSERT INTO notes
                -- the seven columns we fill; updated_at fills itself with NOW()
                (user_id, course_id, title, tags, favorite, category, content)
             -- one placeholder per column, in the same order
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             -- send back the new row using our column list
             RETURNING ${NOTE_COLUMNS}`,
            // Values in order; user_id comes from the token; content is NOT trimmed so markdown spacing survives
            [req.userId, courseId, title.trim(), cleanTags, favorite === true, trimOrUndefined(category), content ?? ""]
        );

        // 201 = created; send the new note in frontend shape
        return res.status(201).json({ note: formatNote(result.rows[0]) });
    // If anything above crashed, land here
    } catch (error) {
        // Real error goes to your terminal
        console.error("Error creating note:", error.message);
        // Vague message goes to the client
        res.status(500).json({ error: "Server error" });
    }
};

// READ: GET /api/notes
export const getNotes = async (req, res) => {
    try {
        // Ask Postgres for this user's notes only
        const result = await pool.query(
            `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = $1 ORDER BY id`,
            // $1 is the logged-in user's id from the token
            [req.userId]
        );
        // Convert every row to frontend shape
        const notes = result.rows.map(formatNote);
        // 200 = OK; an empty list is a normal answer
        return res.status(200).json({ notes });
    } catch (error) {
        console.error("Error getting notes:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};

// UPDATE: PATCH /api/notes/:id (also used to star or unstar with { favorite: true })
export const updateNote = async (req, res) => {
    try {
        // The :id in the URL is text; convert it to a number
        const noteId = Number(req.params.id);
        // Reject ids like "abc" before they reach the database
        if (!Number.isInteger(noteId)) {
            return res.status(400).json({ error: "Invalid note id" });
        }

        // Read the fields; any the client left out are undefined
        const { title, courseId, tags, favorite, category, content } = req.body;

        // If a title was sent, it must be non-blank text of limited length
        if (title != null && !isValidTitle(title)) {
            return res.status(400).json({ error: "Note title must be 1 to 255 characters" });
        }

        // Check the optional fields before touching the database
        const validationError = validateOptionalFields(req.body);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        // Only run these checks if the client is moving the note to another course
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

        // Trim the tags only if they were sent; otherwise leave undefined
        const cleanTags = tags == null ? undefined : tags.map((tag) => tag.trim());

        // Send the UPDATE to Postgres
        const result = await pool.query(
            `UPDATE notes
             SET
                -- COALESCE(new, old): use the new value if one was sent, otherwise keep the old one
                title = COALESCE($1, title),
                course_id = COALESCE($2, course_id),
                tags = COALESCE($3, tags),
                favorite = COALESCE($4, favorite),
                category = COALESCE($5, category),
                content = COALESCE($6, content),
                -- the server stamps the time on EVERY update; the client can never set it
                updated_at = NOW()
             -- the row must match the id AND belong to this user (the ownership check)
             WHERE id = $7 AND user_id = $8
             -- send back the updated row
             RETURNING ${NOTE_COLUMNS}`,
            // Values for $1..$8 in order
            [trimOrUndefined(title), courseId, cleanTags, favorite, trimOrUndefined(category), content, noteId, req.userId]
        );

        // No row came back: wrong id, or someone else's note
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Note not found" });
        }

        // 200 = OK; send the updated note
        return res.status(200).json({ note: formatNote(result.rows[0]) });
    } catch (error) {
        console.error("Error updating note:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};

// DELETE: DELETE /api/notes/:id
export const deleteNote = async (req, res) => {
    try {
        // Convert the :id from the URL to a number
        const noteId = Number(req.params.id);
        // Reject malformed ids
        if (!Number.isInteger(noteId)) {
            return res.status(400).json({ error: "Invalid note id" });
        }

        // Delete only if the id matches AND the note is yours; return the id
        const result = await pool.query(
            `DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id`,
            // $1 is the note id, $2 is the logged-in user
            [noteId, req.userId]
        );

        // Nothing deleted: wrong id or not yours
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Note not found" });
        }

        // 200 = OK; a short confirmation
        return res.status(200).json({ message: "Note deleted" });
    } catch (error) {
        console.error("Error deleting note:", error.message);
        res.status(500).json({ error: "Server error" });
    }
};