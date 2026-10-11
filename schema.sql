CREATE TABLE users(
 id SERIAL PRIMARY KEY,
 name varchar(255) NOT NULL,
 email varchar(255) UNIQUE NOT NULL,
 password TEXT
);