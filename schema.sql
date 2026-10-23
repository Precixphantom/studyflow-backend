-- Change the existing users table
ALTER TABLE users
    -- Each ADD COLUMN IF NOT EXISTS is skipped if the column is already there, so re-running is safe
    ADD COLUMN IF NOT EXISTS major TEXT,
    -- University name, optional
    ADD COLUMN IF NOT EXISTS university TEXT,
    -- Semester label like "Fall 2026", optional
    ADD COLUMN IF NOT EXISTS semester TEXT,
    -- Link to a profile picture, optional
    ADD COLUMN IF NOT EXISTS avatar TEXT,
    -- Target GPA with decimals, must be between 0 and 5
    ADD COLUMN IF NOT EXISTS target_gpa NUMERIC CHECK (target_gpa >= 0 AND target_gpa <= 5),
    -- Current GPA with decimals, must be between 0 and 5
    ADD COLUMN IF NOT EXISTS current_gpa NUMERIC CHECK (current_gpa >= 0 AND current_gpa <= 5),
    -- Whole number of streak days; every existing user gets 0; never negative
    ADD COLUMN IF NOT EXISTS streak_days INTEGER NOT NULL DEFAULT 0 CHECK (streak_days >= 0);

-- Add Google's permanent id for a person to the users table (safe to run twice)
ALTER TABLE users
    -- Empty for password signups; no two users can share one Google id
    ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS courses(
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    instructor TEXT,
    room TEXT,
    color TEXT,
    schedule TEXT,
    grade_goal TEXT,
    credit_hours INTEGER,
    current_grade NUMERIC
);

-- Create the table only if it is not already there
CREATE TABLE IF NOT EXISTS tasks(
    -- Auto-counting primary key, like the other tables
    id SERIAL PRIMARY KEY,
    -- Owner; deleting the user deletes their tasks
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The course this task belongs to; required; deleting the course deletes its tasks
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    -- A task must have a title
    title TEXT NOT NULL,
    -- A calendar date with no time of day, like 2026-07-26
    due_date DATE,
    -- Optional, but if present it must be one of these three words
    priority TEXT CHECK (priority IN ('low', 'medium', 'high')),
    -- Required; starts as 'todo'; must be one of these three words
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'completed')),
    -- Display text like "2 hrs"
    estimated_time TEXT,
    -- A Postgres list of text values; never null; empty list by default
    tags TEXT[] NOT NULL DEFAULT '{}'
);

-- Create the table only if it is not already there
CREATE TABLE IF NOT EXISTS assignments(
    -- Auto-counting primary key
    id SERIAL PRIMARY KEY,
    -- Owner; deleting the user deletes their assignments
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The course it belongs to; required; deleting the course deletes its assignments
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    -- Every assignment needs a title
    title TEXT NOT NULL,
    -- A calendar date with no time of day, like 2026-07-29
    due_date DATE,
    -- Required; starts as 'not_started'; only these four words are allowed
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'submitted', 'graded')),
    -- Optional; if present it must be one of these three words
    priority TEXT CHECK (priority IN ('low', 'medium', 'high')),
    -- Optional number with decimals, never negative
    score NUMERIC CHECK (score >= 0),
    -- Optional number with decimals, must be above zero
    max_score NUMERIC CHECK (max_score > 0),
    -- Optional percentage between 0 and 100
    weight NUMERIC CHECK (weight >= 0 AND weight <= 100),
    -- Optional longer text
    description TEXT
);

-- Create the exams table only if it is not already there
CREATE TABLE IF NOT EXISTS exams(
    -- Auto-counting primary key
    id SERIAL PRIMARY KEY,
    -- Owner; deleting the user deletes their exams
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The course it belongs to; required; deleting the course deletes its exams
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    -- Every exam needs a title
    title TEXT NOT NULL,
    -- Date and time exactly as typed, with no timezone conversion
    exam_date TIMESTAMP,
    -- Optional room or place
    location TEXT,
    -- Optional percentage between 0 and 100
    weight NUMERIC CHECK (weight >= 0 AND weight <= 100),
    -- Optional goal like "A"
    target_grade TEXT
);

-- Create the checklist table: one row per topic
CREATE TABLE IF NOT EXISTS exam_topics(
    -- Auto-counting primary key
    id SERIAL PRIMARY KEY,
    -- Which exam this topic belongs to; deleting the exam deletes its topics
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    -- The topic text; required
    topic TEXT NOT NULL,
    -- Ticked or not; starts unticked
    completed BOOLEAN NOT NULL DEFAULT FALSE
);

-- Create the notes table only if it is not already there
CREATE TABLE IF NOT EXISTS notes(
    -- Auto-counting primary key
    id SERIAL PRIMARY KEY,
    -- Owner; deleting the user deletes their notes
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The course it belongs to; required; deleting the course deletes its notes
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    -- Every note needs a title
    title TEXT NOT NULL,
    -- A Postgres list of text values; never null; empty list by default
    tags TEXT[] NOT NULL DEFAULT '{}',
    -- Starred or not; not starred by default
    favorite BOOLEAN NOT NULL DEFAULT FALSE,
    -- Optional label like "Lecture Notes"
    category TEXT,
    -- The markdown body; empty text by default
    content TEXT NOT NULL DEFAULT '',
    -- The exact moment of the last change, stored as a real point in time; filled in with NOW() on insert
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create the notifications table only if it is not already there
CREATE TABLE IF NOT EXISTS notifications(
    -- Auto-counting primary key
    id SERIAL PRIMARY KEY,
    -- Owner; deleting the user deletes their notifications
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The kind of alert; only these three words are allowed
    type TEXT NOT NULL CHECK (type IN ('exam', 'assignment', 'system')),
    -- Short headline
    title TEXT NOT NULL,
    -- The full sentence shown to the student
    message TEXT NOT NULL,
    -- Has the student seen it; starts unread
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    -- The exact moment it was created; filled in with NOW()
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A label like "exam:5:7d:2026-10-30" that identifies WHICH alert this is
    dedupe_key TEXT NOT NULL,
    -- The same user can never get the same alert twice
    UNIQUE (user_id, dedupe_key)
);