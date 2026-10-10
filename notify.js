// Notifies YOU (the owner) when an application fee is paid — email, SMS, or
// both, depending on what's configured. Both channels fail silently (logged,
// not thrown) so a notification problem never breaks the payment itself.

const nodemailer = require('nodemailer');

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
function emailConfigured() {
  return smtpConfigured() && !!process.env.OWNER_EMAIL;
}
function smsConfigured() {
  return !!(process.env.AFRICASTALKING_USERNAME && process.env.AFRICASTALKING_API_KEY && process.env.OWNER_NOTIFY_PHONE);
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// General-purpose sender — used for user-facing mail (e.g. email
// verification) as well as owner notifications below.
async function sendEmail(to, subject, text) {
  if (!smtpConfigured()) { console.warn('Email skipped (SMTP not configured):', subject, '->', to); return; }
  await getTransporter().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
}

async function sendOwnerEmail(subject, text) {
  if (!emailConfigured()) { console.warn('Owner email skipped (SMTP or OWNER_EMAIL not configured):', subject); return; }
  await sendEmail(process.env.OWNER_EMAIL, subject, text);
}

async function sendOwnerSms(message) {
  if (!smsConfigured()) { console.warn('SMS notification skipped (Africa\'s Talking not configured):', message); return; }
  const host = process.env.AFRICASTALKING_USERNAME === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
  const params = new URLSearchParams({
    username: process.env.AFRICASTALKING_USERNAME,
    to: process.env.OWNER_NOTIFY_PHONE,
    message,
  });
  if (process.env.AFRICASTALKING_SENDER_ID) params.set('from', process.env.AFRICASTALKING_SENDER_ID);

  const res = await fetch(`https://${host}/version1/messaging`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', apiKey: process.env.AFRICASTALKING_API_KEY },
    body: params.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Africa's Talking SMS failed: ${res.status} ${detail}`);
  }
}

// Fires both channels in parallel; one failing doesn't stop the other, and
// neither failing ever throws back to the caller (payment confirmation must
// still succeed even if notifying you doesn't).
async function notifyOwnerOfPayment({ jobTitle, company, amount, payerPhone, receipt }) {
  const subject = `Bazzo Careers: KES ${amount} application fee paid`;
  const emailBody =
    `New application fee paid.\n\n` +
    `Job: ${jobTitle} at ${company}\n` +
    `Amount: KES ${amount}\n` +
    `Paid by: ${payerPhone}\n` +
    `M-Pesa receipt: ${receipt || 'n/a'}\n\n` +
    `Cross-check this against your M-Pesa statement before relying on it as a record.\n\n` +
    `— Bazzo Careers`;
  const smsBody = `Bazzo: KES ${amount} fee paid by ${payerPhone} for "${jobTitle}". Receipt ${receipt || 'n/a'}.`;

  const results = await Promise.allSettled([sendOwnerEmail(subject, emailBody), sendOwnerSms(smsBody)]);
  results.forEach((r) => { if (r.status === 'rejected') console.error('Owner notification failed:', r.reason.message); });
}

async function sendVerificationEmail(user, verifyUrl) {
  const subject = 'Verify your Bazzo Careers email';
  const text =
    `Hi ${user.name},\n\n` +
    `Welcome to Bazzo Careers! Confirm this is your email address by opening the link below:\n\n` +
    `${verifyUrl}\n\n` +
    `This link expires in 24 hours. If you didn't create this account, you can ignore this email.\n\n` +
    `— The Bazzo Careers Team`;
  await sendEmail(user.email, subject, text);
}

module.exports = { notifyOwnerOfPayment, sendVerificationEmail, smtpConfigured, emailConfigured, smsConfigured };
