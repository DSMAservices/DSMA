require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const rateLimit = require("express-rate-limit");

const app = express();
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const isProduction = process.env.NODE_ENV === "production";
const demoMode = process.env.DEMO_MODE === "true";
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) { console.error("SESSION_SECRET must be set to a random value at least 32 characters long."); process.exit(1); }

const dbOptions = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 10, charset: "utf8mb4" };
const pool = demoMode ? null : mysql.createPool(dbOptions);
const sessionStore = demoMode ? undefined : new MySQLStore(dbOptions);
const demoAccounts = [
  { id: 1, name: "Demo DSMA Team", business_name: null, email: "team@dsma.demo", password_hash: bcrypt.hashSync("DSMA-team-2026", 10), role: "team" },
  { id: 2, name: "Demo Business Contact", business_name: "Demo Business", email: "customer@dsma.demo", password_hash: bcrypt.hashSync("DSMA-customer-2026", 10), role: "customer" }
];
let demoTickets = [];
let demoContacts = [];
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "https://fonts.googleapis.com"], fontSrc: ["'self'", "https://fonts.gstatic.com"], scriptSrc: ["'self'"], imgSrc: ["'self'", "data:"] } } }));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(session({ name: "dsma.sid", secret: process.env.SESSION_SECRET, ...(sessionStore ? { store: sessionStore } : {}), resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 } }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });
const send = (res, data, status = 200) => res.status(status).json(data);
const cleanEmail = (value) => String(value || "").trim().toLowerCase();
const csrfToken = (req) => { if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString("hex"); return req.session.csrf; };
const requireCsrf = (req, res, next) => { const expected = req.session.csrf || ""; const provided = req.get("x-csrf-token") || ""; if (!expected || expected.length !== provided.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return send(res, { error: "Invalid security token. Refresh and try again." }, 419); next(); };
const requireAuth = (role) => (req, res, next) => { if (!req.session.user || (role && req.session.user.role !== role)) return send(res, { error: "You are not authorized for this action." }, 401); next(); };
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.get("/api/auth.php", (req, res) => { if (req.query.action === "csrf") return send(res, { csrf: csrfToken(req) }); if (req.query.action === "me") return send(res, { user: req.session.user || null, demoMode }); return send(res, { error: "Unknown authentication action." }, 404); });
app.post("/api/auth.php", authLimiter, asyncRoute(async (req, res, next) => {
  if (req.query.action === "logout") return requireCsrf(req, res, () => req.session.destroy(() => send(res, { ok: true })));
  if (req.query.action !== "login") return send(res, { error: "Unknown authentication action." }, 404);
  const email = cleanEmail(req.body.email); const password = String(req.body.password || ""); const role = req.body.role === "team" ? "team" : "customer";
  if (!email || password.length < 6) return send(res, { error: "Enter a valid email and password." }, 422);
  let account;
  if (demoMode) account = demoAccounts.find((item) => item.email === email && item.role === role);
  else { const [rows] = await pool.execute("SELECT id, name, business_name, email, password_hash, role FROM users WHERE email = ? AND role = ? AND active = 1 LIMIT 1", [email, role]); account = rows[0]; }
  if (!account || !(await bcrypt.compare(password, account.password_hash))) return send(res, { error: "Email or password is incorrect." }, 401);
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve())); const safeAccount = { ...account }; delete safeAccount.password_hash; req.session.user = safeAccount; csrfToken(req); send(res, { user: safeAccount });
}));

app.get("/api/tickets.php", requireAuth(), asyncRoute(async (req, res) => {
  let rows;
  if (demoMode) rows = req.session.user.role === "customer" ? demoTickets.filter((ticket) => ticket.customer_id === req.session.user.id) : demoTickets;
  else if (req.session.user.role === "customer") { [rows] = await pool.execute("SELECT id, subject, details, status, eta_date, created_at, updated_at FROM tickets WHERE customer_id = ? ORDER BY created_at DESC", [req.session.user.id]); }
  else { [rows] = await pool.execute("SELECT t.id, t.subject, t.details, t.status, t.eta_date, t.created_at, t.updated_at, u.business_name, u.email FROM tickets t JOIN users u ON u.id = t.customer_id ORDER BY t.created_at DESC"); }
  send(res, { tickets: rows });
}));
app.post("/api/tickets.php", requireCsrf, requireAuth("customer"), asyncRoute(async (req, res) => { const subject = String(req.body.subject || "").trim(); const details = String(req.body.details || "").trim(); if (!subject || !details) return send(res, { error: "Subject and details are required." }, 422); const id = `DSMA-${crypto.randomBytes(3).toString("hex").toUpperCase()}`; if (demoMode) { demoTickets.unshift({ id, customer_id: req.session.user.id, subject, details, status: "New", eta_date: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), business_name: "Demo Business", email: req.session.user.email }); } else await pool.execute("INSERT INTO tickets (id, customer_id, subject, details, status) VALUES (?, ?, ?, ?, 'New')", [id, req.session.user.id, subject, details]); send(res, { id }, 201); }));
app.patch("/api/tickets.php", requireCsrf, requireAuth(), asyncRoute(async (req, res) => {
  const id = String(req.body.id || "").trim(); if (!id) return send(res, { error: "Ticket id is required." }, 422);
  if (demoMode) { const ticket = demoTickets.find((item) => item.id === id); if (!ticket || (req.session.user.role === "customer" && ticket.customer_id !== req.session.user.id)) return send(res, { error: "Ticket not found or not editable." }, 404); if (req.session.user.role === "customer") { ticket.subject = String(req.body.subject || "").trim(); ticket.details = String(req.body.details || "").trim(); } else { ticket.status = ["New", "In progress", "Waiting", "Complete"].includes(req.body.status) ? req.body.status : "New"; ticket.eta_date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.eta_date || "")) ? req.body.eta_date : null; } ticket.updated_at = new Date().toISOString(); }
  else if (req.session.user.role === "customer") { const [owned] = await pool.execute("SELECT id FROM tickets WHERE id = ? AND customer_id = ?", [id, req.session.user.id]); if (!owned.length) return send(res, { error: "Ticket not found or not editable." }, 404); await pool.execute("UPDATE tickets SET subject = ?, details = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND customer_id = ?", [String(req.body.subject || "").trim(), String(req.body.details || "").trim(), id, req.session.user.id]); }
  else { const statuses = ["New", "In progress", "Waiting", "Complete"]; const status = statuses.includes(req.body.status) ? req.body.status : "New"; const eta = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.eta_date || "")) ? req.body.eta_date : null; const [updated] = await pool.execute("UPDATE tickets SET status = ?, eta_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, eta, id]); if (!updated.affectedRows) return send(res, { error: "Ticket not found." }, 404); }
  send(res, { ok: true });
}));
app.delete("/api/tickets.php", requireCsrf, requireAuth(), asyncRoute(async (req, res) => {
  const id = String(req.body.id || "").trim();
  if (!id) return send(res, { error: "Ticket id is required." }, 422);
  if (demoMode) {
    const index = demoTickets.findIndex((ticket) => ticket.id === id && (req.session.user.role === "team" || ticket.customer_id === req.session.user.id));
    if (index === -1) return send(res, { error: "Ticket not found or not available to delete." }, 404);
    demoTickets.splice(index, 1);
  } else {
    const query = req.session.user.role === "customer"
      ? ["DELETE FROM tickets WHERE id = ? AND customer_id = ?", [id, req.session.user.id]]
      : ["DELETE FROM tickets WHERE id = ?", [id]];
    const [deleted] = await pool.execute(query[0], query[1]);
    if (!deleted.affectedRows) return send(res, { error: "Ticket not found or not available to delete." }, 404);
  }
  send(res, { ok: true });
}));

app.post("/api/team.php", requireCsrf, requireAuth("team"), asyncRoute(async (req, res) => { const name = String(req.body.name || "").trim(); const business = String(req.body.business || "").trim(); const email = cleanEmail(req.body.email); const password = String(req.body.password || ""); if (!name || !business || !email || password.length < 8) return send(res, { error: "Enter all details and a password of at least 8 characters." }, 422); if (demoMode) { if (demoAccounts.some((account) => account.email === email)) return send(res, { error: "An account with that email already exists." }, 409); demoAccounts.push({ id: Date.now(), name, business_name: business, email, password_hash: await bcrypt.hash(password, 10), role: "customer" }); send(res, { ok: true, email }, 201); } else { try { await pool.execute("INSERT INTO users (name, business_name, email, password_hash, role) VALUES (?, ?, ?, ?, 'customer')", [name, business, email, await bcrypt.hash(password, 12)]); send(res, { ok: true, email }, 201); } catch (error) { if (error.code === "ER_DUP_ENTRY") return send(res, { error: "An account with that email already exists." }, 409); throw error; } } }));
app.post("/api/contact.php", requireCsrf, asyncRoute(async (req, res) => { const name = String(req.body.name || "").trim(); const email = cleanEmail(req.body.email); const message = String(req.body.message || "").trim(); if (!name || !email || !message) return send(res, { error: "Complete all contact fields." }, 422); if (demoMode) demoContacts.push({ name, email, message, created_at: new Date().toISOString() }); else await pool.execute("INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)", [name, email, message]); send(res, { ok: true }, 201); }));

app.use(["/api", "/database", "/tools"], (req, res) => res.status(404).json({ error: "Not found." }));
app.use(express.static(root, { extensions: ["html"], index: "index.html" }));
app.use((req, res) => res.status(404).json({ error: "Not found." }));
app.use((error, req, res, next) => { console.error(error); if (res.headersSent) return next(error); send(res, { error: "Server error." }, 500); });
const host = process.env.DEMO_LOCAL_ONLY === "true" ? "127.0.0.1" : "0.0.0.0";
app.listen(port, host, () => console.log(`DSMA server listening at http://${host}:${port}/portal.html${demoMode ? " (demo mode)" : ""}`));

