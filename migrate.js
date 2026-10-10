const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

// Applies schema.sql. Safe to call every time the server starts — every
// statement in it is "if not exists", so re-running it on an already-current
// database is a harmless no-op.
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { migrate };

// Still runnable directly: `node src/migrate.js` / `npm run migrate`.
if (require.main === module) {
  require('dotenv').config();
  migrate()
    .then(() => { console.log('Done. Tables are ready and seed jobs are in place (if the table was empty).'); return pool.end(); })
    .catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
}
