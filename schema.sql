-- Bazzo job board schema
-- Run once against your database, e.g.:
--   psql "$DATABASE_URL" -f schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS users_verification_token_idx ON users (verification_token);

CREATE TABLE IF NOT EXISTS jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  company     TEXT NOT NULL,
  location    TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('office','gig','trade','remote','hospitality')),
  pay         TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_category_idx ON jobs (category);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_posted_by_idx ON jobs (posted_by);

CREATE TABLE IF NOT EXISTS applications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS applications_job_id_idx ON applications (job_id);
CREATE INDEX IF NOT EXISTS applications_user_id_idx ON applications (user_id);

-- One row per application attempt that requires an M-Pesa payment.
-- The matching `applications` row is only created once the payment succeeds.
CREATE TABLE IF NOT EXISTS payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id       UUID REFERENCES applications(id) ON DELETE SET NULL,
  phone                TEXT NOT NULL,
  amount               NUMERIC(10,2) NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  checkout_request_id  TEXT UNIQUE,
  merchant_request_id  TEXT,
  mpesa_receipt        TEXT,
  result_desc          TEXT,
  pending_name         TEXT,
  pending_email        TEXT,
  pending_note         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments (user_id);
CREATE INDEX IF NOT EXISTS payments_checkout_idx ON payments (checkout_request_id);

-- Seed data — safe to re-run (only inserts if the table is empty)
INSERT INTO jobs (title, company, location, category, pay, description)
SELECT * FROM (VALUES
  ('Junior Accountant', 'Meridian Traders', 'Nairobi, Kenya', 'office', 'KES 55,000–70,000/mo', 'Handle daily reconciliations and support month-end close for a mid-size import business. Comfortable with QuickBooks and Excel preferred.'),
  ('Motorbike Delivery Rider', 'QuickCart', 'Nairobi, Kenya', 'gig', 'KES 1,200/day + tips', 'Deliver orders across Westlands and Kilimani. Own bike required, fuel allowance provided. Flexible shifts.'),
  ('Electrician (Residential)', 'BrightWire Services', 'Mombasa, Kenya', 'trade', 'KES 2,500/day', 'Wiring and fault repair for residential clients. Must hold a valid trade certificate and have 2+ years experience.'),
  ('Customer Support Agent', 'Helio Labs', 'Remote (worldwide)', 'remote', '$900–1,200/mo', 'Answer support tickets for a small SaaS product, US hours. Written English fluency and a calm troubleshooting style matter more than a degree.'),
  ('Barista', 'Roasted & Co.', 'Nairobi, Kenya', 'hospitality', 'KES 25,000/mo + tips', 'Morning shift at a busy café in Lavington. Latte art a plus but trainable. Weekend availability needed.'),
  ('Freelance Graphic Designer', 'Independent clients', 'Remote (worldwide)', 'gig', 'Project-based', 'Ongoing pipeline of logo and social media design briefs for small businesses. Portfolio required.'),
  ('Warehouse Supervisor', 'Coastal Logistics', 'Mombasa, Kenya', 'trade', 'KES 60,000/mo', 'Oversee inbound/outbound stock and a team of 8. Forklift certification and 3+ years supervisory experience required.'),
  ('Frontend Engineer', 'Nomad Systems', 'Remote (worldwide)', 'remote', '$2,500–3,500/mo', 'React and TypeScript work on a small product team, async-first, four-day week. Open to strong juniors with a solid portfolio.'),
  ('Hotel Front Desk Officer', 'Kilima Lodge', 'Nakuru, Kenya', 'hospitality', 'KES 30,000/mo', 'Guest check-in/out, booking system management, and handling guest requests. Hospitality diploma preferred, not required.'),
  ('House Painter', 'Independent contract', 'Kisumu, Kenya', 'trade', 'KES 1,800/day', 'Two-week interior painting job for a residential complex. Own basic tools needed; materials supplied.'),
  ('Social Media Manager', 'Bloom Cosmetics', 'Nairobi, Kenya', 'office', 'KES 65,000/mo', 'Run content calendar and community management across Instagram and TikTok for a growing beauty brand.'),
  ('Data Entry Clerk (part-time)', 'Various clients', 'Remote (worldwide)', 'gig', 'KES 400/hr', 'Short-term data cleanup projects, flexible hours, paid weekly. Strong attention to detail needed.'),
  ('Registered Nurse', 'St. Aldwyn Hospital', 'London, UK', 'office', '£29,000–34,000/yr', 'General ward nursing, rotating shifts. UK NMC registration required; visa sponsorship available for the right candidate.'),
  ('Construction Laborer', 'Falcon Builders', 'Dubai, UAE', 'trade', 'AED 2,800/mo + housing', 'General site labor on a commercial build. Accommodation and transport provided. Contract renewable annually.'),
  ('Backend Engineer (Go)', 'Northlight Software', 'Remote (worldwide)', 'remote', '$4,000–6,000/mo', 'Distributed systems work for a payments infrastructure startup. Fully async, hire from any timezone within +/-4hrs of UTC.'),
  ('English Tutor (Online)', 'LinguaBridge', 'Remote (worldwide)', 'gig', '$15–25/hr', 'Teach conversational English to adult learners in Asia and Latin America over video calls. Flexible evening/weekend slots.'),
  ('Restaurant Line Cook', 'Harbor House', 'Toronto, Canada', 'hospitality', 'CAD 19/hr', 'Busy dinner service, Italian-leaning menu. Prior line experience preferred; work permit sponsorship considered for strong candidates.'),
  ('Marketing Coordinator', 'Solari Goods', 'Lagos, Nigeria', 'office', '₦280,000/mo', 'Run campaigns across email and social for a fast-growing homeware brand shipping across West Africa.'),
  ('Truck Driver (Long Haul)', 'Meridian Freight', 'Texas, USA', 'trade', '$0.58/mile', 'Regional and long-haul routes across the southern US. CDL-A required, 1+ year verifiable experience.'),
  ('UX Designer', 'Fernweh Studio', 'Remote (worldwide)', 'remote', '€3,200–4,000/mo', 'Product design for a travel-tech client base spread across Europe. Portfolio with real shipped work required.')
) AS seed(title, company, location, category, pay, description)
WHERE NOT EXISTS (SELECT 1 FROM jobs);
