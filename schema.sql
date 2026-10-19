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