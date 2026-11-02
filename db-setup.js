// First-start database setup, so nobody has to import SQL or run a terminal command by hand.
// 1. Creates any missing tables (safe to run on every start: it never changes existing data).
// 2. If TEAM_EMAIL and TEAM_PASSWORD are set and no team account exists yet, creates the first team login.
//    After you can sign in, delete TEAM_PASSWORD from the environment settings.
const bcrypt = require("bcryptjs");

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    business_name VARCHAR(160) NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('team','customer') NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(20) PRIMARY KEY,
    customer_id INT UNSIGNED NOT NULL,
    subject VARCHAR(200) NOT NULL,
    details TEXT NOT NULL,
    status ENUM('New','In progress','Waiting','Complete') NOT NULL DEFAULT 'New',
    eta_date DATE NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT tickets_customer_fk FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX tickets_customer_idx (customer_id),
    INDEX tickets_status_idx (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS contact_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

async function ensureDatabase(pool, env = process.env) {
  for (const sql of TABLES) await pool.query(sql);
  const email = String(env.TEAM_EMAIL || "").trim().toLowerCase();
  const password = String(env.TEAM_PASSWORD || "");
  if (!email || !password) return;
  if (password.length < 8) { console.error("TEAM_PASSWORD must be at least 8 characters, so no team account was created."); return; }
  const [existing] = await pool.execute("SELECT id FROM users WHERE role = 'team' LIMIT 1");
  if (existing.length) return;
  await pool.execute("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'team')", [String(env.TEAM_NAME || "DSMA Team").trim(), email, await bcrypt.hash(password, 12)]);
  console.log(`First team account created for ${email}. Remove TEAM_PASSWORD from the environment settings now.`);
}

module.exports = { ensureDatabase };
