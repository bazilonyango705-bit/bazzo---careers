# Bazzo — backend

A small Express + PostgreSQL API for the Bazzo job board, plus the frontend
(`public/index.html`) wired up to call it. One service can serve both.

## What's here

```
src/
  index.js               Express app: routes, CORS, rate limiting, serves public/
  db.js                  Postgres connection pool
  migrate.js             Applies schema.sql
  middleware/auth.js     JWT check for signed-in routes
  routes/auth.js         POST /api/auth/register, /login, GET /api/auth/me
  routes/profile.js      GET /api/profile (your posted jobs + applications)
  routes/jobs.js         GET/POST /api/jobs, GET /api/jobs/:id
  routes/applications.js POST /api/jobs/:id/apply
  routes/cv.js           POST /api/cv/generate (Claude-powered CV builder)
public/index.html   The frontend (fetches from /api)
schema.sql          Tables (users, jobs, applications) + 20 seed job listings
.env.example
```

## The app at a glance

Bazzo is a worldwide job marketplace. The frontend is a LinkedIn-style single page
with this flow:

**Welcome** (what Bazzo is) → **Sign in / Join** → **Home** (profile card, latest
jobs, quick actions) → **Jobs** (search + category filters) → **Job details**
(read, then apply) → **Profile** (jobs you posted, your applications).
Posting a job and building a CV with AI are available from the top nav on every screen.

## 1. Get a Postgres database

Any of these work — pick one:
- **Local**: install Postgres, then `createdb bazzo`
- **Hosted (free tiers exist)**: [Neon](https://neon.tech), [Supabase](https://supabase.com), [Railway](https://railway.app), or [Render](https://render.com) — create a Postgres instance and copy its connection string

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to your connection string. If your host needs SSL
with a self-signed cert (Render/Railway are typical), set `PGSSL=true`.

To enable the **AI CV builder**, also set `ANTHROPIC_API_KEY` — get one at
[console.anthropic.com](https://console.anthropic.com/settings/keys). Each generated
CV costs a small amount on your Anthropic account (a few cents at most with the
default model); the route is rate-limited to 5 requests/minute per server to keep
costs predictable. Leave the key blank to ship without this feature — the button
still shows, but generating returns a clear "not configured" message instead of
crashing.

Set `JWT_SECRET` to enable **accounts** (register/login/profile) — generate one with
`openssl rand -hex 32`. Posting a job and applying to one both require being signed
in. Leave it blank and those routes return a clear "not configured" message instead
of crashing.

## 3. Install

```bash
npm install
```

The database schema is applied **automatically every time the server
starts** (`src/migrate.js`, called from `src/index.js`) — no separate step
needed, including on hosts with no shell access (like Render's free tier).
Every statement is "create if not exists," so this is safe to run on every
boot. If you'd rather run it manually once (e.g. before the first deploy),
`npm run migrate` still works standalone.

## 4. Run it

```bash
npm start
```

Visit `http://localhost:3000` — the frontend and API are served from the same
place, so nothing else to configure locally.

## 5. Deploy it for real

Any Node host works (Render, Railway, Fly.io, a VPS, etc.). General shape:

1. Push this folder to a Git repo.
2. Create a new **Web Service** on your host, pointing at that repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Set the environment variables from `.env` in the host's dashboard
   (`DATABASE_URL`, `PGSSL`, `CORS_ORIGIN`).
4. Run the migration once against your production database — most hosts let you
   run a one-off shell command (`npm run migrate`), or run it from your machine
   with `DATABASE_URL` pointed at production.
5. Open the deployed URL — the frontend and API are both served from it.

If you ever split the frontend out to its own host (Vercel/Netlify/a Claude
artifact) instead of serving it from Express, two things change:
- Set `API_BASE` near the top of `public/index.html`'s `<script>` to your API's
  full URL (e.g. `https://bazzo-api.onrender.com/api`).
- Set `CORS_ORIGIN` in the backend's `.env` to that frontend's real URL, so the
  browser is allowed to call the API cross-origin.

**Note:** a page published through Claude's own Artifact tool cannot call an
external API like this one — Claude's artifact hosting only allows outbound
requests to a short list of script CDNs. So keep the frontend here (served by
Express) or deploy it to a plain static host (Vercel, Netlify, GitHub Pages,
Render static site) rather than publishing it as a Claude artifact.

## 6. M-Pesa: application fees

Job seekers pay `APPLICATION_FEE_KES` (default KES 50) via M-Pesa STK push to
apply. The full fee goes straight into whatever account sits behind
`MPESA_SHORTCODE` — there's no separate payout step, so the money is simply
there. This needs real Safaricom credentials — here's the path to get there:

1. Create an account at [developer.safaricom.co.ke](https://developer.safaricom.co.ke) and make a new app. This gives you a sandbox `Consumer Key` and `Consumer Secret` — put them in `.env`.
2. For **testing**, `MPESA_SHORTCODE=174379` and a test `MPESA_PASSKEY` are provided on Safaricom's docs under the STK Push / Lipa na M-Pesa Online sample — use those as-is. STK pushes in sandbox only work against Safaricom's published **test phone numbers**, not real ones.
3. `MPESA_CALLBACK_BASE_URL` must be a real public HTTPS URL — Safaricom cannot call `localhost`. Deploy the app first, or use a tunnel tool (e.g. ngrok) temporarily while testing.
4. For **real payments landing on +254 710 929 595**: that number needs to be registered with Safaricom as a receiving account for API collections — most simply via **Pochi la Biashara** (Safaricom's program letting a personal number collect business payments) or a full Paybill/Till if you want more features. Either way, Safaricom issues you a `Shortcode` tied to that number once you're approved — put that in `MPESA_SHORTCODE`, switch `MPESA_ENV=production`, and swap in your production `Consumer Key`/`Secret`/`Passkey`. This approval step is on Safaricom's side and isn't instant.

**I could not test any of this from this sandbox** — there's no live network
access here, so please test carefully with Safaricom's sandbox numbers before
processing real payments.

## 7. Email verification (required)

New accounts can't use any part of the app — browsing jobs, applying,
posting, the CV builder, the profile page — until their email is verified.
This is enforced on the **backend** (`requireVerified` in
`middleware/auth.js`, checked fresh against the database on every request),
not just hidden in the UI, so it can't be bypassed by calling the API directly.

What happens:
1. On registration, a verification email is sent automatically (needs SMTP
   configured — see section 8 below. Without SMTP set up, no email goes out
   and the account stays permanently unverified, so **set up SMTP before
   letting real people register**).
2. The person lands on a "Verify your email" screen and stays there — they
   can resend the email or sign out, but can't reach the rest of the app.
3. Clicking the link in the email (`GET /api/auth/verify?token=...`) marks
   them verified and shows a plain confirmation page.
4. Set `APP_BASE_URL` in `.env` to your deployed URL — the link in the email
   is built from this, so it won't work correctly on `localhost` once deployed.

## 8. Get notified when someone pays

The moment a payment is confirmed, Bazzo can email and/or text you
automatically (`src/services/notify.js`, triggered from the STK callback).
Both channels are independent — set up either one, both, or neither. If
nothing is configured, notifications are silently skipped and logged;
payments still work normally either way.

**Email** — works with any SMTP provider:
- Gmail: use an [App Password](https://myaccount.google.com/apppasswords) (not your normal password) with `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`.
- Any other provider (Outlook, Zoho, your own mail server): use the SMTP host/port/credentials they give you.
- Set `OWNER_EMAIL` to where you want notifications sent.

**SMS** — via [Africa's Talking](https://africastalking.com), the standard way to send SMS to Kenyan numbers by API:
1. Create an account and an app at africastalking.com.
2. Use `AFRICASTALKING_USERNAME=sandbox` and your sandbox `AFRICASTALKING_API_KEY` to test for free — sandbox messages don't actually reach a phone but you can confirm the request succeeds.
3. For real SMS to **+254 710 929 595**: apply for a production account/sender ID in their dashboard, then switch `AFRICASTALKING_USERNAME` to your live username and use your production API key.

Each notification includes the job title, company, amount, payer's phone, and
the M-Pesa receipt number — enough to cross-check against your M-Pesa
statement, which is worth doing rather than treating the notification alone
as proof of payment (the `payments` table in your database is the source of truth).

## API reference

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | `{name, email, password}` | Returns `{token, user}` |
| POST | `/api/auth/login` | `{email, password}` | Returns `{token, user}` |
| GET | `/api/auth/me` | — | Requires `Authorization: Bearer <token>` |
| GET | `/api/auth/verify` | — | The link from the verification email (`?token=...`). Returns an HTML page, not JSON |
| POST | `/api/auth/resend-verification` | — | Requires auth |
| GET | `/api/profile` | — | Requires auth. Your posted jobs + applications |
| GET | `/api/jobs` | — | Query params: `q`, `category` (matches title/company/description/location) |
| GET | `/api/jobs/:id` | — | |
| POST | `/api/jobs` | `{title, company, location, category, pay, description}` | Requires auth. `category` ∈ office/gig/trade/remote/hospitality |
| POST | `/api/jobs/:id/apply` | `{name, email, note, phone}` | Requires auth. `phone` required only if `APPLICATION_FEE_KES > 0`. Returns `202` + `checkoutRequestId` when a payment is pending, or `201` immediately if free |
| GET | `/api/payments/:checkoutRequestId` | — | Requires auth. Poll this while waiting for the M-Pesa PIN prompt to be completed |
| POST | `/api/mpesa/stk-callback` | — | Safaricom webhook — not for direct use |
| POST | `/api/cv/generate` | `{name, targetRole, experience, education, skills, notes}` | Requires `ANTHROPIC_API_KEY`; rate-limited to 5/min |
| GET | `/api/health` | — | Liveness check |

## Where to go next

- **Password reset**: email verification is required and enforced now, but
  there's still no "forgot password" flow — someone locked out has no way
  back in except a direct database fix.
- **Abuse protection**: rate limiting is in place but basic; add a CAPTCHA on
  registration before opening this to the public internet.
- **Compliance**: charging fees and moving money automatically may have tax,
  licensing, or consumer-protection obligations depending on where you
  operate — worth a conversation with an accountant or lawyer before going
  live with real payments. (Not legal or financial advice — just a nudge to check.)
- **Notify employers too**: you (the owner) now get emailed/texted when a fee
  is paid, but the employer whose job it is does not yet hear about new
  applications — worth adding if different people post jobs than you.
