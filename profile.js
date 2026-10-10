const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireVerified } = require('../middleware/auth');

const router = express.Router();

// GET /api/profile
router.get('/', requireAuth, requireVerified, async (req, res) => {
  try {
    const jobs = await pool.query(
      'SELECT id, title, company, location, category, created_at FROM jobs WHERE posted_by = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    const applications = await pool.query(
      `SELECT a.id, a.created_at, j.id AS job_id, j.title AS job_title, j.company
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json({
      user: req.user,
      postedJobs: jobs.rows,
      applications: applications.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load your profile.' });
  }
});

module.exports = router;
