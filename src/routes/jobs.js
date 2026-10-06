const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireVerified } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = ['office', 'gig', 'trade', 'remote', 'hospitality'];

// GET /api/jobs?q=&location=&category=
router.get('/', requireAuth, requireVerified, async (req, res) => {
  const { q, location, category } = req.query;
  const clauses = [];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(title ILIKE $${params.length} OR company ILIKE $${params.length} OR description ILIKE $${params.length} OR location ILIKE $${params.length})`);
  }
  if (location) {
    params.push(`%${location}%`);
    clauses.push(`location ILIKE $${params.length}`);
  }
  if (category) {
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
    }
    params.push(category);
    clauses.push(`category = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  try {
    const result = await pool.query(
      `SELECT id, title, company, location, category, pay, description, created_at
       FROM jobs ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load jobs.' });
  }
});

// GET /api/jobs/:id
router.get('/:id', requireAuth, requireVerified, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load job.' });
  }
});

// POST /api/jobs  { title, company, location, category, pay, description }
router.post('/', requireAuth, requireVerified, async (req, res) => {
  const { title, company, location, category, pay, description } = req.body || {};

  if (!title || !company || !location || !category) {
    return res.status(400).json({ error: 'title, company, location, and category are required.' });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
  }

  try {
    const result = await pool.query(
      `INSERT INTO jobs (title, company, location, category, pay, description, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title.trim(), company.trim(), location.trim(), category, (pay || '').trim(), (description || '').trim(), req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not post job.' });
  }
});

module.exports = router;
