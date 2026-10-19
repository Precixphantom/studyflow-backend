CREATE TABLE IF NOT EXISTS users(
 id SERIAL PRIMARY KEY,
 name varchar(255) NOT NULL,
 email varchar(255) UNIQUE NOT NULL,
 password TEXT
);

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