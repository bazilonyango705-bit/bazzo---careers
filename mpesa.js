const express = require('express');
const { pool } = require('../db');
const notify = require('../services/notify');

const router = express.Router();

// POST /api/mpesa/stk-callback — Safaricom calls this after the applicant
// enters (or cancels) their M-Pesa PIN. No auth: Safaricom can't send our JWT.
// We always respond 200 so Safaricom doesn't retry forever; the real outcome
// is recorded in the `payments` table either way.
router.post('/stk-callback', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Received' }); // ack first, Safaricom expects this fast
  try {
    const cb = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!cb || !cb.CheckoutRequestID) return;

    const payment = await pool.query('SELECT * FROM payments WHERE checkout_request_id = $1', [cb.CheckoutRequestID]);
    if (!payment.rows.length) return console.error('STK callback for unknown payment:', cb.CheckoutRequestID);
    const p = payment.rows[0];
    if (p.status !== 'pending') return; // already handled — Safaricom can resend callbacks

    if (cb.ResultCode !== 0) {
      await pool.query(`UPDATE payments SET status = 'failed', result_desc = $2, updated_at = now() WHERE id = $1`, [p.id, cb.ResultDesc || 'Payment failed.']);
      return;
    }

    const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
    const get = (name) => { const it = items.find((i) => i.Name === name); return it ? it.Value : null; };
    const receipt = get('MpesaReceiptNumber');

    const app = await pool.query(
      `INSERT INTO applications (job_id, name, email, note, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [p.job_id, p.pending_name, p.pending_email, p.pending_note, p.user_id]
    );
    await pool.query(
      `UPDATE payments SET status = 'paid', mpesa_receipt = $2, application_id = $3, result_desc = $4, updated_at = now() WHERE id = $1`,
      [p.id, receipt, app.rows[0].id, cb.ResultDesc || 'Paid']
    );
    // The full fee was paid straight into MPESA_SHORTCODE — no separate payout step.

    // Tell the owner it happened — fire-and-forget, never blocks confirming the payment itself.
    const job = await pool.query('SELECT title, company FROM jobs WHERE id = $1', [p.job_id]);
    notify.notifyOwnerOfPayment({
      jobTitle: job.rows[0] ? job.rows[0].title : 'a job',
      company: job.rows[0] ? job.rows[0].company : '',
      amount: p.amount,
      payerPhone: p.phone,
      receipt,
    }).catch((e) => console.error('Owner notification error:', e.message));
  } catch (err) {
    console.error('Error handling STK callback:', err);
  }
});

module.exports = router;
