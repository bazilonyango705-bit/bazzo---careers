const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const notify = require('../services/notify');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.MPESA_CALLBACK_BASE_URL || '').replace(/\/$/, '');
}

// Generates a fresh verification token for a user, saves it (24h expiry),
// and emails it — fire-and-forget, never blocks the caller.
async function issueVerificationEmail(user) {
  if (!notify.smtpConfigured()) return; // nothing to do if email isn't set up
  const base = appBaseUrl();
  if (!base) { console.warn('Skipping verification email — set APP_BASE_URL so the link works.'); return; }

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `UPDATE users SET verification_token = $2, verification_token_expires = now() + interval '24 hours' WHERE id = $1`,
    [user.id, token]
  );
  const verifyUrl = `${base}/api/auth/verify?token=${token}`;
  notify.sendVerificationEmail(user, verifyUrl).catch((e) => console.error('Verification email failed:', e.message));
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// POST /api/auth/register  { name, email, password }
router.post('/register', async (req, res) => {
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'Accounts are not configured. Set JWT_SECRET in the server environment.' });
  }
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required.' });
  }
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'That email address does not look valid.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with that email already exists.' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name.trim(), email.toLowerCase().trim(), hash]
    );
    const user = result.rows[0];
    issueVerificationEmail(user).catch((e) => console.error('Could not issue verification email:', e.message));
    res.status(201).json({ token: signToken(user), user: { ...user, emailVerified: false } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create your account.' });
  }
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res) => {
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'Accounts are not configured. Set JWT_SECRET in the server environment.' });
  }
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required.' });

  try {
    const result = await pool.query('SELECT id, name, email, password_hash, email_verified_at FROM users WHERE email = $1', [String(email).toLowerCase().trim()]);
    if (!result.rows.length) return res.status(401).json({ error: 'Incorrect email or password.' });

    const row = result.rows[0];
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    const user = { id: row.id, name: row.name, email: row.email };
    res.json({ token: signToken(user), user: { ...user, emailVerified: !!row.email_verified_at } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not sign you in.' });
  }
});

// GET /api/auth/me — queries fresh (not just the JWT payload) so verifying
// your email mid-session shows up without needing to log in again.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, email_verified_at FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows.length) return res.status(401).json({ error: 'Account no longer exists.' });
    const row = result.rows[0];
    res.json({ user: { id: row.id, name: row.name, email: row.email, emailVerified: !!row.email_verified_at } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load your account.' });
  }
});

// GET /api/auth/verify?token=... — the link in the verification email.
// Not JSON: the user opens this directly in their browser, so it returns a
// small HTML page rather than requiring them to come back to the app first.
router.get('/verify', async (req, res) => {
  const page = (title, body) => res.send(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>body{font-family:-apple-system,sans-serif;max-width:420px;margin:80px auto;padding:0 20px;text-align:center;color:#191919}` +
    `h1{font-size:20px}a{color:#0A66C2}</style></head><body><h1>${title}</h1><p>${body}</p></body></html>`
  );
  const { token } = req.query;
  if (!token) return res.status(400).send(page('Missing link', 'This verification link is incomplete.'));

  try {
    const result = await pool.query(
      `SELECT id FROM users WHERE verification_token = $1 AND verification_token_expires > now()`,
      [token]
    );
    if (!result.rows.length) {
      return res.status(400).send(page('Link expired or invalid', 'Sign in to Bazzo Careers and request a new verification email.'));
    }
    await pool.query(
      `UPDATE users SET email_verified_at = now(), verification_token = NULL, verification_token_expires = NULL WHERE id = $1`,
      [result.rows[0].id]
    );
    res.send(page('Email verified ✓', 'You can close this tab and return to Bazzo Careers.'));
  } catch (err) {
    console.error(err);
    res.status(500).send(page('Something went wrong', 'Please try again shortly.'));
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, email_verified_at FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (user.email_verified_at) return res.json({ message: 'Your email is already verified.' });
    if (!notify.smtpConfigured()) return res.status(503).json({ error: 'Email is not configured on this server yet.' });

    await issueVerificationEmail(user);
    res.json({ message: `Verification email sent to ${user.email}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not resend the verification email.' });
  }
});

module.exports = router;
