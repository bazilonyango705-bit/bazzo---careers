const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/payments/:checkoutRequestId — the frontend polls this while
// waiting for the applicant to enter their M-Pesa PIN.
router.get('/:checkoutRequestId', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT status, application_id, result_desc, job_id FROM payments WHERE checkout_request_id = $1 AND user_id = $2',
      [req.params.checkoutRequestId, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Payment not found.' });
    const p = result.rows[0];

    let message = 'Waiting for you to enter your M-Pesa PIN…';
    if (p.status === 'paid') message = 'Payment confirmed — application sent.';
    if (p.status === 'failed') message = p.result_desc || 'Payment failed or was cancelled.';

    res.json({ status: p.status, applicationId: p.application_id, jobId: p.job_id, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not check payment status.' });
  }
});

module.exports = router;
