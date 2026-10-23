// Import crypto to make random values and compare them safely
import crypto from "crypto";
// Import dotenv so the environment variables are loaded before we read them
import dotenv from "dotenv";
// Import Passport, the library that handles the handshake with Google
import passport from "passport";
// Import the Google strategy package (its constructor is the "Strategy" property)
import GoogleStrategyModule from "passport-google-oauth20";
// Import the database pool so we can find and create users
import pool from "./db.js";

// Load the .env file (running it twice is harmless)
dotenv.config();

// The Google strategy constructor
const GoogleStrategy = GoogleStrategyModule.Strategy;

// Read the settings from the environment
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL, FRONTEND_URL } = process.env;

// True only if everything Google login needs is set
export const googleConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL && FRONTEND_URL);

// Only mark the cookie "secure" (https only) when the callback address is https
const useSecureCookie = (GOOGLE_CALLBACK_URL || "").startsWith("https://");
// The name of the cookie that remembers the login attempt
const STATE_COOKIE = "oauth_state";
// The cookie only travels to the Google routes
const STATE_COOKIE_PATH = "/api/auth/google";

// Our own "state" keeper: proves the person coming back from Google is the one who started the login
const stateStore = {
    // Runs when the login starts: make a random value, keep it in a cookie, and give it to Google too
    store(req, callback) {
        // 24 random bytes written as 48 hex characters
        const state = crypto.randomBytes(24).toString("hex");
        // Set the cookie on the response that is about to redirect to Google
        req.res.cookie(STATE_COOKIE, state, {
            // JavaScript in the browser cannot read it
            httpOnly: true,
            // https only when the callback is https
            secure: useSecureCookie,
            // Sent when Google redirects the browser back to us
            sameSite: "lax",
            // Expires after 10 minutes
            maxAge: 10 * 60 * 1000,
            // Only sent to the Google routes
            path: STATE_COOKIE_PATH
        });
        // Hand the value to Passport so it goes to Google
        callback(null, state);
    },
    // Runs when Google sends the user back: the value Google returns must match the cookie
    verify(req, state, callback) {
        // The value we saved in the cookie (undefined if there is no cookie)
        const saved = req.cookies ? req.cookies[STATE_COOKIE] : undefined;
        // Delete the cookie so it can never be reused
        req.res.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });
        // Both values must exist, have the same length, and match (compared in constant time)
        const ok = typeof saved === "string" && typeof state === "string" && saved.length === state.length && crypto.timingSafeEqual(Buffer.from(saved), Buffer.from(state));
        // If they do not match, reject with a code we recognise
        if (!ok) {
            return callback(null, false, { code: "invalid_state" });
        }
        // They match, so continue
        callback(null, true);
    }
};

// Finds the user for this Google person, or creates one
const findOrCreateGoogleUser = async (profile) => {
    // Google's permanent id for this person ("sub"), which never changes
    const googleId = profile._json.sub;
    // The email Google reports, cleaned the same way as in signup
    const email = typeof profile._json.email === "string" ? profile._json.email.trim().toLowerCase() : "";
    // Google says whether it checked this email belongs to the person
    const emailVerified = profile._json.email_verified === true;

    // We need an id and a verified email, or we refuse
    if (!googleId || !email || !emailVerified) {
        // Shows in your terminal so you can debug
        console.warn("Google login rejected: id missing, or email missing or not verified");
        return { user: false, info: { code: "email_not_verified" } };
    }

    // Is this Google person already one of our users?
    const byGoogle = await pool.query(`SELECT id FROM users WHERE google_id = $1`, [googleId]);
    // Yes: log them in
    if (byGoogle.rows.length > 0) {
        return { user: byGoogle.rows[0] };
    }

    // Does a different account already use this email (a password signup)?
    const byEmail = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
    // Yes: refuse to link, because signup never proved who owns that email
    if (byEmail.rows.length > 0) {
        return { user: false, info: { code: "email_exists" } };
    }

    // The name Google gave, or the part of the email before the @ if there is none
    const displayName = (typeof profile._json.name === "string" ? profile._json.name.trim() : "") || email.split("@")[0];
    // Keep the picture only if it is an https link
    const picture = typeof profile._json.picture === "string" && profile._json.picture.startsWith("https://") ? profile._json.picture : null;

    // Create the new user; there is no password because they sign in with Google
    const created = await pool.query(
        `INSERT INTO users (name, email, google_id, avatar) VALUES ($1, $2, $3, $4) RETURNING id`,
        // name is cut to 255 characters to fit the column
        [displayName.slice(0, 255), email, googleId, picture]
    );
    // Log them in
    return { user: created.rows[0] };
};

// Only set the strategy up if everything is configured, so a missing variable cannot crash the server
if (googleConfigured) {
    // Register the Google strategy with Passport
    passport.use(new GoogleStrategy(
        {
            // Identifies your app to Google
            clientID: GOOGLE_CLIENT_ID,
            // Proves it is really your server (never sent to the browser)
            clientSecret: GOOGLE_CLIENT_SECRET,
            // The full address Google sends the user back to
            callbackURL: GOOGLE_CALLBACK_URL,
            // Use our cookie-based state checker
            store: stateStore
        },
        // Runs after Google has confirmed who the person is
        async (accessToken, refreshToken, profile, done) => {
            // Run the normal path
            try {
                // Find or create the user
                const { user, info } = await findOrCreateGoogleUser(profile);
                // Tell Passport the result
                return done(null, user, info);
            // If something crashed, land here
            } catch (error) {
                // Two first-time logins at once: the second insert hits the UNIQUE rule (code 23505)
                if (error.code === "23505") {
                    // Look for the user the other request just created
                    const again = await pool.query(`SELECT id FROM users WHERE google_id = $1`, [profile._json.sub]);
                    // Found: log them in
                    if (again.rows.length > 0) {
                        return done(null, again.rows[0]);
                    }
                    // Not found: the email must belong to another account
                    return done(null, false, { code: "email_exists" });
                }
                // Anything else is a real error
                return done(error);
            }
        }
    ));
} else {
    // Tell you in the terminal that Google login is switched off
    console.warn("Google login is not configured (missing GOOGLE_* or FRONTEND_URL): Google routes will answer 503");
}

// Export Passport itself so other files use the same instance
export default passport;