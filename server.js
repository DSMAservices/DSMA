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
const { createMailer } = require("./mailer");

const app = express();
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const isProduction = process.env.NODE_ENV === "production";
const demoMode = process.env.DEMO_MODE === "true";
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) { console.error("SESSION_SECRET must be set to a random value at least 32 characters long."); process.exit(1); }

const dbOptions = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 10, charset: "utf8mb4" };
const pool = demoMode ? null : mysql.createPool(dbOptions);
if (pool) require("./db-setup").ensureDatabase(pool).catch((error) => console.error("Database setup failed:", error.message));
const sessionStore = demoMode ? undefined : new MySQLStore(dbOptions);
const demoAccounts = [
  { id: 1, name: "Demo DSMA Team", business_name: null, email: "team@dsma.demo", password_hash: bcrypt.hashSync("DSMA-team-2026", 10), role: "team" },
  { id: 2, name: "Demo Business Contact", business_name: "Demo Business", email: "customer@dsma.demo", password_hash: bcrypt.hashSync("DSMA-customer-2026", 10), role: "customer" }
];
let demoTickets = [];
let demoContacts = [];
let demoMessages = [];
let demoFiles = [];
let demoSeq = 1;
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "https://fonts.googleapis.com"], fontSrc: ["'self'", "https://fonts.gstatic.com"], scriptSrc: ["'self'"], imgSrc: ["'self'", "data:"] } } }));
app.use(["/api/messages.php", "/api/tickets.php"], express.json({ limit: "28mb" }));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(session({ name: "dsma.sid", secret: process.env.SESSION_SECRET, ...(sessionStore ? { store: sessionStore } : {}), resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 } }));

const mailer = createMailer();
console.log(mailer.enabled ? `Contact form emails go to ${mailer.to}.` : "Contact form emails are OFF: set SMTP_HOST, SMTP_USER and SMTP_PASS to turn them on.");
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many messages. Please try again later." } });
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

// ---- Message attachments ----
const MAX_FILES = 4;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], jpeg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46, 0x38], pdf: [0x25, 0x50, 0x44, 0x46] };
const cleanFileName = (value) => String(value || "file").split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>:*?|]/g, "").trim().slice(0, 150) || "file";
// Returns { files } or { error }. The type comes from the file extension, never from what the browser claims.
const parseAttachments = (list) => {
  if (list === undefined || list === null) return { files: [] };
  if (!Array.isArray(list)) return { error: "Attachments are not valid." };
  if (list.length > MAX_FILES) return { error: `You can attach up to ${MAX_FILES} files at a time.` };
  const files = [];
  for (const item of list) {
    const name = cleanFileName(item && item.name); const ext = (name.split(".").pop() || "").toLowerCase();
    if (!FILE_TYPES[ext] || !name.includes(".")) return { error: `"${name}" is not an allowed file type. Use images, PDF, Word, Excel, PowerPoint, CSV or text files.` };
    const data = Buffer.from(String((item && item.data) || ""), "base64");
    if (!data.length) return { error: `"${name}" is empty.` };
    if (data.length > MAX_FILE_BYTES) return { error: `"${name}" is larger than 5 MB.` };
    if (MAGIC[ext] && !MAGIC[ext].every((byte, index) => data[index] === byte)) return { error: `"${name}" does not look like a real .${ext} file.` };
    if (ext === "webp" && data.subarray(8, 12).toString("ascii") !== "WEBP") return { error: `"${name}" does not look like a real .webp file.` };
    files.push({ name, mime: FILE_TYPES[ext], size: data.length, data });
  }
  return { files };
};
// Can this signed-in user see this ticket? Returns the ticket row or null.
const ticketFor = async (user, id) => {
  if (demoMode) { const ticket = demoTickets.find((item) => item.id === id); return ticket && (user.role === "team" || ticket.customer_id === user.id) ? ticket : null; }
  const [rows] = await pool.execute(user.role === "team" ? "SELECT id, customer_id FROM tickets WHERE id = ?" : "SELECT id, customer_id FROM tickets WHERE id = ? AND customer_id = ?", user.role === "team" ? [id] : [id, user.id]);
  return rows[0] || null;
};
const addMessage = async (ticketId, user, body, files) => {
  if (demoMode) {
    const message = { id: demoSeq++, ticket_id: ticketId, author_id: user.id, author_role: user.role, author_name: user.role === "team" ? "DSMA team" : (user.business_name || user.name), body, created_at: new Date().toISOString() };
    demoMessages.push(message);
    for (const file of files) demoFiles.push({ id: demoSeq++, message_id: message.id, ticket_id: ticketId, name: file.name, mime: file.mime, size: file.size, data: file.data });
    return message.id;
  }
  const [inserted] = await pool.execute("INSERT INTO ticket_messages (ticket_id, author_id, author_role, body) VALUES (?, ?, ?, ?)", [ticketId, user.id, user.role, body]);
  for (const file of files) await pool.execute("INSERT INTO ticket_files (message_id, ticket_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?, ?)", [inserted.insertId, ticketId, file.name, file.mime, file.size, file.data]);
  await pool.execute("UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [ticketId]);
  return inserted.insertId;
};
const messageLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many messages. Please wait a few minutes." } });

app.get("/api/messages.php", requireAuth(), asyncRoute(async (req, res) => {
  const id = String(req.query.ticket_id || "").trim();
  if (!(await ticketFor(req.session.user, id))) return send(res, { error: "Request not found." }, 404);
  let messages; let files;
  if (demoMode) {
    messages = demoMessages.filter((item) => item.ticket_id === id);
    files = demoFiles.filter((item) => item.ticket_id === id).map(({ id: fileId, message_id, name, mime, size }) => ({ id: fileId, message_id, name, mime, size }));
  } else {
    [messages] = await pool.execute("SELECT m.id, m.author_role, m.body, m.created_at, COALESCE(u.business_name, u.name) AS author_name FROM ticket_messages m JOIN users u ON u.id = m.author_id WHERE m.ticket_id = ? ORDER BY m.created_at, m.id", [id]);
    [files] = await pool.execute("SELECT id, message_id, name, mime, size FROM ticket_files WHERE ticket_id = ? ORDER BY id", [id]);
  }
  send(res, { messages: messages.map((message) => ({ id: message.id, author_role: message.author_role, author_name: message.author_role === "team" ? "DSMA team" : message.author_name, body: message.body, created_at: message.created_at, files: files.filter((file) => String(file.message_id) === String(message.id)).map(({ id: fileId, name, mime, size }) => ({ id: fileId, name, mime, size, image: INLINE_TYPES.has(mime) })) })) });
}));
app.post("/api/messages.php", messageLimiter, requireCsrf, requireAuth(), asyncRoute(async (req, res) => {
  const id = String(req.body.ticket_id || "").trim(); const body = String(req.body.body || "").trim();
  if (!(await ticketFor(req.session.user, id))) return send(res, { error: "Request not found." }, 404);
  if (body.length > 5000) return send(res, { error: "That message is too long." }, 422);
  const parsed = parseAttachments(req.body.attachments);
  if (parsed.error) return send(res, { error: parsed.error }, 422);
  if (!body && !parsed.files.length) return send(res, { error: "Write a message or attach a file." }, 422);
  await addMessage(id, req.session.user, body, parsed.files);
  send(res, { ok: true }, 201);
}));
app.get("/api/files.php", requireAuth(), asyncRoute(async (req, res) => {
  const id = Number(req.query.id); let file;
  if (!Number.isInteger(id)) return send(res, { error: "File not found." }, 404);
  if (demoMode) file = demoFiles.find((item) => item.id === id);
  else { const [rows] = await pool.execute("SELECT ticket_id, name, mime, data FROM ticket_files WHERE id = ?", [id]); file = rows[0]; }
  if (!file || !(await ticketFor(req.session.user, file.ticket_id))) return send(res, { error: "File not found." }, 404);
  const inline = INLINE_TYPES.has(file.mime) && req.query.download !== "1";
  res.set({ "Content-Type": file.mime, "Content-Length": file.data.length, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}` });
  res.send(file.data);
}));

app.get("/api/tickets.php", requireAuth(), asyncRoute(async (req, res) => {
  let rows;
  if (demoMode) rows = req.session.user.role === "customer" ? demoTickets.filter((ticket) => ticket.customer_id === req.session.user.id) : demoTickets;
  else if (req.session.user.role === "customer") { [rows] = await pool.execute("SELECT id, subject, details, status, eta_date, created_at, updated_at, (SELECT m.author_role FROM ticket_messages m WHERE m.ticket_id = tickets.id ORDER BY m.id DESC LIMIT 1) AS last_author_role FROM tickets WHERE customer_id = ? ORDER BY created_at DESC", [req.session.user.id]); }
  else { [rows] = await pool.execute("SELECT t.id, t.subject, t.details, t.status, t.eta_date, t.created_at, t.updated_at, u.business_name, u.email, (SELECT m.author_role FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_author_role FROM tickets t JOIN users u ON u.id = t.customer_id ORDER BY t.created_at DESC"); }
  if (demoMode) rows = rows.map((ticket) => ({ ...ticket, last_author_role: ([...demoMessages].reverse().find((message) => message.ticket_id === ticket.id) || {}).author_role || null }));
  send(res, { tickets: rows });
}));
app.post("/api/tickets.php", requireCsrf, requireAuth("customer"), asyncRoute(async (req, res) => { const subject = String(req.body.subject || "").trim(); const details = String(req.body.details || "").trim(); if (!subject || !details) return send(res, { error: "Subject and details are required." }, 422); if (subject.length > 200 || details.length > 5000) return send(res, { error: "Subject or details are too long." }, 422); const parsed = parseAttachments(req.body.attachments); if (parsed.error) return send(res, { error: parsed.error }, 422); const id = `DSMA-${crypto.randomBytes(3).toString("hex").toUpperCase()}`; if (demoMode) { demoTickets.unshift({ id, customer_id: req.session.user.id, subject, details, status: "New", eta_date: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), business_name: "Demo Business", email: req.session.user.email }); } else await pool.execute("INSERT INTO tickets (id, customer_id, subject, details, status) VALUES (?, ?, ?, ?, 'New')", [id, req.session.user.id, subject, details]); if (parsed.files.length) await addMessage(id, req.session.user, "", parsed.files); send(res, { id }, 201); }));
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
    demoMessages = demoMessages.filter((message) => message.ticket_id !== id); demoFiles = demoFiles.filter((file) => file.ticket_id !== id);
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
app.post("/api/contact.php", contactLimiter, requireCsrf, asyncRoute(async (req, res) => {
  if (String(req.body.website || "").trim()) return send(res, { ok: true }, 201); // hidden spam-trap field: real visitors leave it empty
  const name = String(req.body.name || "").trim(); const email = cleanEmail(req.body.email); const message = String(req.body.message || "").trim();
  const language = String(req.body.language || "").slice(0, 5).toLowerCase();
  if (!name || !email || !message) return send(res, { error: "Complete all contact fields." }, 422);
  if (name.length > 120 || email.length > 190 || message.length > 5000) return send(res, { error: "One of the fields is too long." }, 422);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, { error: "Enter a valid email address." }, 422);
  const receivedAt = new Date();
  if (demoMode) demoContacts.push({ name, email, message, created_at: receivedAt.toISOString() }); else await pool.execute("INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)", [name, email, message]);
  // The message is already saved, so an email problem is logged but never shown to the visitor as a failure.
  try { await mailer.sendContact({ name, email, message, language, receivedAt }); } catch (error) { console.error("Contact email failed:", error.message); }
  send(res, { ok: true }, 201);
}));

app.use(["/api", "/database", "/tools"], (req, res) => res.status(404).json({ error: "Not found." }));
app.use(/^\/(server|mailer|db-setup)\.js$|^\/package(-lock)?\.json$|^\/(README|HOSTINGER_DEPLOY)\.md$|^\/node_modules\//i, (req, res) => res.status(404).json({ error: "Not found." }));
app.use(express.static(root, { extensions: ["html"], index: "index.html" }));
app.use((req, res) => res.status(404).json({ error: "Not found." }));
app.use((error, req, res, next) => { console.error(error); if (res.headersSent) return next(error); send(res, { error: "Server error." }, 500); });
const host = process.env.DEMO_LOCAL_ONLY === "true" ? "127.0.0.1" : "0.0.0.0";
app.listen(port, host, () => console.log(`DSMA server listening at http://${host}:${port}/portal.html${demoMode ? " (demo mode)" : ""}`));

