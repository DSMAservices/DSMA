// Emails every contact-form submission to the DSMA team.
// Settings come from environment variables (see .env.example); nothing secret lives in this file.
// Loaded lazily so the site still starts if the package has not been installed yet.
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch { /* reported by createMailer below */ }

const LANGUAGE_NAMES = { en: "English", es: "Spanish", zh: "Chinese", ar: "Arabic", fr: "French", pt: "Portuguese", vi: "Vietnamese", tr: "Turkish", ja: "Japanese", te: "Telugu" };
const DEFAULT_TO = "dsmaservicesbps@gmail.com";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Header values must never contain line breaks (prevents header injection).
const oneLine = (value) => String(value ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").trim();

function buildContactEmail({ name, email, message, language, receivedAt }) {
  const when = (receivedAt instanceof Date ? receivedAt : new Date(receivedAt || Date.now())).toUTCString();
  const languageName = LANGUAGE_NAMES[language] || "Not given";
  const subject = `New DSMA contact message from ${oneLine(name).slice(0, 80)}`;
  const text = [
    "A new message was sent through the DSMA website contact form.",
    "",
    `Name: ${oneLine(name)}`,
    `Email: ${oneLine(email)}`,
    `Language on the website: ${languageName}`,
    `Received: ${when}`,
    "",
    "Message:",
    String(message ?? ""),
    "",
    "Reply to this email to answer the sender directly."
  ].join("\n");
  const row = (label, value) => `<tr><td style="padding:6px 16px 6px 0;color:#55556a;white-space:nowrap;vertical-align:top"><strong>${label}</strong></td><td style="padding:6px 0">${value}</td></tr>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#2d2f45;max-width:620px">
<h2 style="margin:0 0 12px">New message from the DSMA website</h2>
<table style="border-collapse:collapse">${row("Name", escapeHtml(oneLine(name)))}${row("Email", `<a href="mailto:${escapeHtml(oneLine(email))}">${escapeHtml(oneLine(email))}</a>`)}${row("Language", escapeHtml(languageName))}${row("Received", escapeHtml(when))}</table>
<p style="margin:18px 0 6px"><strong>Message</strong></p>
<div style="white-space:pre-wrap;border-left:4px solid #d27f65;padding:8px 14px;background:#f3f1e0">${escapeHtml(message)}</div>
<p style="color:#55556a;margin-top:18px">Reply to this email to answer the sender directly.</p></div>`;
  return { subject, text, html };
}

function buildResetEmail({ name, link }) {
  const subject = "Reset your DSMA portal password";
  const who = oneLine(name) || "there";
  const text = [`Hi ${who},`, "", "Someone asked to reset the password for your DSMA portal account. Open this link within one hour to choose a new password:", "", link, "", "If you did not ask for this, you can ignore this email. Your password will not change."].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#2d2f45;max-width:560px">
<h2 style="margin:0 0 12px">Reset your DSMA portal password</h2>
<p>Hi ${escapeHtml(who)},</p>
<p>Someone asked to reset the password for your DSMA portal account. The link works for one hour.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#3e4059;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Choose a new password</a></p>
<p style="color:#55556a">If the button does not work, copy this link into your browser:<br>${escapeHtml(link)}</p>
<p style="color:#55556a">If you did not ask for this, you can ignore this email. Your password will not change.</p></div>`;
  return { subject, text, html };
}

function createMailer(env = process.env) {
  const host = env.SMTP_HOST, user = env.SMTP_USER, pass = env.SMTP_PASS;
  const to = oneLine(env.CONTACT_TO || DEFAULT_TO);
  if (!host || !user || !pass) return { enabled: false, to, sendContact: async () => ({ skipped: true }), sendReset: async () => ({ skipped: true }) };
  if (!nodemailer) { console.error("Contact emails are OFF: the nodemailer package is not installed. Run npm install."); return { enabled: false, to, sendContact: async () => ({ skipped: true }), sendReset: async () => ({ skipped: true }) }; }
  const port = Number(env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host, port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
    auth: { user, pass },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
  });
  const from = oneLine(env.SMTP_FROM || user);
  return {
    enabled: true,
    to,
    async sendContact(details) {
      const { subject, text, html } = buildContactEmail(details);
      await transporter.sendMail({
        from: { name: "DSMA website", address: from },
        to,
        replyTo: { name: oneLine(details.name).slice(0, 120), address: oneLine(details.email) },
        subject, text, html
      });
      return { sent: true };
    },
    async sendReset({ to: recipient, name, link }) {
      const { subject, text, html } = buildResetEmail({ name, link });
      await transporter.sendMail({ from: { name: "DSMA portal", address: from }, to: oneLine(recipient), subject, text, html });
      return { sent: true };
    }
  };
}

module.exports = { buildContactEmail, buildResetEmail, createMailer };
