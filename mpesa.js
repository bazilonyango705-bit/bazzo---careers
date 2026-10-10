// Minimal client for Safaricom's Daraja API — just what Bazzo needs:
// an OAuth token and STK Push (charge the applicant). The fee lands directly
// in the account behind MPESA_SHORTCODE — no separate payout step.
// Docs: https://developer.safaricom.co.ke

const BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

function isConfigured() {
  return !!(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET && process.env.MPESA_SHORTCODE && process.env.MPESA_PASSKEY);
}

// Accepts 07.., 01.., 2547.., 2541.., or +254... and returns the 2547XXXXXXXX
// format Safaricom's APIs require. Throws on anything that doesn't look Kenyan.
function normalizePhone(input) {
  let p = String(input || '').replace(/[^\d]/g, '');
  if (p.startsWith('0') && p.length === 10) p = '254' + p.slice(1);
  else if (p.startsWith('254') && p.length === 12) { /* already correct */ }
  else if ((p.startsWith('7') || p.startsWith('1')) && p.length === 9) p = '254' + p;
  else throw new Error('Enter a valid Kenyan phone number, e.g. 0712345678.');
  if (!/^254[17]\d{8}$/.test(p)) throw new Error('Enter a valid Kenyan phone number, e.g. 0712345678.');
  return p;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

let cachedToken = null; // { token, expiresAt }
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) return cachedToken.token;

  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error('Could not authenticate with M-Pesa (check MPESA_CONSUMER_KEY/SECRET).');
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.token;
}

// Prompts the payer's phone for their M-Pesa PIN. Result arrives later via the
// callback URL, not in this response — this response only confirms the prompt was sent.
async function stkPush({ phone, amount, accountRef, description }) {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const ts = timestamp();
  const password = Buffer.from(shortcode + passkey + ts).toString('base64');
  const token = await getAccessToken();
  const callbackBase = (process.env.MPESA_CALLBACK_BASE_URL || '').replace(/\/$/, '');
  if (!callbackBase) throw new Error('MPESA_CALLBACK_BASE_URL is not set — Safaricom needs a public URL to call back.');

  const res = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: `${callbackBase}/api/mpesa/stk-callback`,
      AccountReference: accountRef.slice(0, 12),
      TransactionDesc: description.slice(0, 13),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ResponseCode !== '0') {
    throw new Error(data.errorMessage || data.ResponseDescription || 'M-Pesa did not accept the payment request.');
  }
  return data; // { MerchantRequestID, CheckoutRequestID, ... }
}

module.exports = { isConfigured, normalizePhone, stkPush };
