// Import jwt to make our own login token
import jwt from "jsonwebtoken";
// Import Passport and the flag that says whether Google login is set up
import passport, { googleConfigured } from "../config/passport.js";

// The only error codes we are willing to put in a redirect address
const FAILURE_CODES = ["email_exists", "email_not_verified", "invalid_state"];

// The frontend address, with any trailing slashes removed
const frontendUrl = () => (process.env.FRONTEND_URL || "").replace(/\/+$/, "");

// START: GET /api/auth/google (the browser is sent to Google)
export const googleLogin = (req, res, next) => {
    // If Google login is not set up, say so with a JSON 503
    if (!googleConfigured) {
        return res.status(503).json({ error: "Google login is not configured" });
    }
    // Hand over to Passport, which redirects the browser to Google
    passport.authenticate("google", {
        // Ask Google for the person's name, picture and email
        scope: ["profile", "email"],
        // We use our own token, not server sessions
        session: false,
        // Always let the person choose which Google account to use
        prompt: "select_account"
    })(req, res, next);
};

// FINISH: GET /api/auth/google/callback (Google sends the browser back here)
export const googleCallback = (req, res, next) => {
    // If Google login is not set up, say so with a JSON 503
    if (!googleConfigured) {
        return res.status(503).json({ error: "Google login is not configured" });
    }
    // Run Passport with our own function so we decide what happens next
    passport.authenticate("google", { session: false }, (error, user, info) => {
        // A real error happened (for example Google refused the code)
        if (error) {
            // Real error goes to your terminal
            console.error("Google callback error:", error.message);
            // Send the person back to the login page with a generic code
            return res.redirect(`${frontendUrl()}/login?error=google_failed`);
        }
        // No user: the login was refused or cancelled
        if (!user) {
            // Use our code if it is one we know; otherwise a generic one (never echo unknown text)
            const code = info && FAILURE_CODES.includes(info.code) ? info.code : "google_failed";
            // Send the person back to the login page with that code
            return res.redirect(`${frontendUrl()}/login?error=${code}`);
        }
        // Success: make OUR OWN token with only the id, exactly like password login
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        // Send the person to the frontend callback page with the token, as the contract says
        return res.redirect(`${frontendUrl()}/auth/callback?token=${encodeURIComponent(token)}`);
    })(req, res, next);
};