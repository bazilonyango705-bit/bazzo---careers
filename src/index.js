require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const jobsRouter = require('./routes/jobs');
const applicationsRouter = require('./routes/applications');
const cvRouter = require('./routes/cv');
const authRouter = require('./routes/auth');
const profileRouter = require('./routes/profile');
const mpesaRouter = require('./routes/mpesa');
const paymentsRouter = require('./routes/payments');

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin.split(',') }));
app.use(express.json({ limit: '100kb' }));

// Generous limit for browsing, tighter for writes (posting jobs / applying).
app.use('/api', rateLimit({ windowMs: 60_000, max: 120 }));
const writeLimiter = rateLimit({ windowMs: 60_000, max: 10 });

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/config', (req, res) => res.json({ applicationFeeKes: Number(process.env.APPLICATION_FEE_KES || 0) }));

app.use('/api/jobs', (req, res, next) => (req.method === 'POST' ? writeLimiter(req, res, next) : next()));
app.use('/api/jobs', jobsRouter);
app.use('/api/jobs', (req, res, next) => (req.method === 'POST' ? writeLimiter(req, res, next) : next()));
app.use('/api/jobs', applicationsRouter);

const cvLimiter = rateLimit({ windowMs: 60_000, max: 5 }); // AI calls cost money — keep this tight
app.use('/api/cv', cvLimiter);
app.use('/api/cv', cvRouter);

const authLimiter = rateLimit({ windowMs: 60_000, max: 20 }); // guard against credential-stuffing / brute force
app.use('/api/auth', authLimiter);
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);

app.use('/api/mpesa', mpesaRouter); // Safaricom webhooks — no auth, no rate limit
app.use('/api/payments', paymentsRouter);

// Serve the frontend (public/index.html) so the whole app can be deployed as one service.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const { migrate } = require('./migrate');
const port = process.env.PORT || 3000;

migrate()
  .then(() => {
    console.log('Database schema is up to date.');
    app.listen(port, () => console.log(`Bazzo API listening on port ${port}`));
  })
  .catch((err) => {
    console.error('Startup migration failed — not starting the server:', err.message);
    process.exit(1);
  });
