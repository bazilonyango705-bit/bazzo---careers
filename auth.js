const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const notify = require('../services/notify');

// Protects a route: requires a valid "Authorization: Bearer <token>" header.
// On success, attaches { id, name, email } to req.user.
function requireAuth(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'Accounts are not configured. Set JWT_SECRET in the server environment.' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired — sign in again.' });
  }
}

// Blocks an action until the account's email is verified. Always use AFTER
// requireAuth (needs req.user.id). Checks the database fresh each time —
// not the JWT — so verifying mid-session takes effect immediately.
//
// If the server has no email configured (SMTP_* unset) there is no way to
// send a verification link, so enforcing it would lock every new account out
// permanently. In that case the requirement is skipped; it switches itself
// back on the moment SMTP is configured.
async function requireVerified(req, res, next) {
  if (!notify.smtpConfigured()) return next();
  try {
    const result = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows.length) return res.status(401).json({ error: 'Account no longer exists.' });
    if (!result.rows[0].email_verified_at) {
      return res.status(403).json({ error: 'Verify your email before using this — check your inbox, or resend the link from your profile.', code: 'EMAIL_NOT_VERIFIED' });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not check your account.' });
  }
}

module.exports = { requireAuth, requireVerified };
