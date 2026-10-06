const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireVerified } = require('../middleware/auth');
const mpesa = require('../services/mpesa');

const router = express.Router({ mergeParams: true });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FEE = Number(process.env.APPLICATION_FEE_KES || 0);

// POST /api/jobs/:jobId/apply  { name, email, note, phone? }
// If APPLICATION_FEE_KES is unset/0, this applies for free, same as before.
// Otherwise it charges `phone` via M-Pesa STK push and only creates the
// application once that payment is confirmed (see routes/mpesa.js).
router.post('/:jobId/apply', requireAuth, requireVerified, async (req, res) => {
  const { jobId } = req.params;
  const { name, email, note, phone } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'That email address does not look valid.' });
  }

  try {
    const job = await pool.query('SELECT id, title, company FROM jobs WHERE id = $1', [jobId]);
    if (job.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });

    if (FEE <= 0) {
      const result = await pool.query(
        `INSERT INTO applications (job_id, name, email, note, user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [jobId, name.trim(), email.trim(), (note || '').trim(), req.user.id]
      );
      return res.status(201).json({
        id: result.rows[0].id,
        job: job.rows[0],
        paid: false,
        message: `Application sent to ${job.rows[0].company}.`,
      });
    }

    if (!mpesa.isConfigured()) {
      return res.status(503).json({ error: `Applying costs KES ${FEE}, but M-Pesa is not configured on this server yet.` });
    }
    let normalizedPhone;
    try { normalizedPhone = mpesa.normalizePhone(phone); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const payment = await pool.query(
      `INSERT INTO payments (job_id, user_id, phone, amount, pending_name, pending_email, pending_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [jobId, req.user.id, normalizedPhone, FEE, name.trim(), email.trim(), (note || '').trim()]
    );

    let stk;
    try {
      stk = await mpesa.stkPush({
        phone: normalizedPhone,
        amount: FEE,
        accountRef: 'BazzoApply',
        description: `Apply: ${job.rows[0].title}`.slice(0, 13),
      });
    } catch (e) {
      await pool.query(`UPDATE payments SET status = 'failed', result_desc = $2, updated_at = now() WHERE id = $1`, [payment.rows[0].id, e.message]);
      return res.status(502).json({ error: e.message });
    }

    await pool.query(
      `UPDATE payments SET checkout_request_id = $2, merchant_request_id = $3, updated_at = now() WHERE id = $1`,
      [payment.rows[0].id, stk.CheckoutRequestID, stk.MerchantRequestID]
    );

    res.status(202).json({
      paid: false,
      pendingPayment: true,
      checkoutRequestId: stk.CheckoutRequestID,
      message: `Check your phone (${phone}) and enter your M-Pesa PIN to pay KES ${FEE}.`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not submit application.' });
  }
});

module.exports = router;
