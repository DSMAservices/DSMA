# DSMA website

The production DSMA site, including its Swiss visual direction and private customer portal. This is the same project to deploy through the existing Hostinger Node.js app.

The public site and private portal use the same Node/Express backend as the original: customer sign-in, owned tickets, edit requests, status and ETA tracking, team sign-in, account creation, and the contact form. Database setup is in `database/schema.sql`; deployment details are in `HOSTINGER_DEPLOY.md`.

## Preview locally

From this folder, run `npm install`, then `npm run demo`. Open `http://127.0.0.1:3000/portal.html` (not the `file://` copy). The demo command supplies its own session secret, needs no database, and only listens on your computer.

Customer demo: `customer@dsma.demo` / `DSMA-customer-2026`  
DSMA team demo: `team@dsma.demo` / `DSMA-team-2026`

In demo mode, the portal shows one-click buttons to fill those sign-in details. With `DEMO_MODE=false`, those details are hidden and the site requires the MySQL settings in `.env` and the imported schema. Demo data lives in memory and disappears when the server restarts. For a configured non-demo server, copy `.env.example` to `.env`, fill in real settings, and use `npm start`.

## Contact form emails

Messages from the contact form are saved and emailed to `dsmaservicesbps@gmail.com` once the `SMTP_*` settings in `.env.example` are filled in. See `HOSTINGER_DEPLOY.md` for the Gmail steps.

## Before launch

- `assets/dsma-community.png` is the current shared community image and is intentionally used with several color treatments. Replace it with approved final photography when available.
- Replace the team and official contact placeholders with verified details.
- Use real database credentials and a strong `SESSION_SECRET`; set `DEMO_MODE=false`.
- Enable HTTPS on the final domain and verify customer and team workflows there.

The design loads Archivo from Google Fonts. The CSS includes system font fallbacks; the server’s content security policy allows only that font stylesheet and font files in addition to local assets.


## Portal messages and attachments

Each request is a conversation between the business and the DSMA team. Either side can attach up to 4 files per message (images, PDF, Word, Excel, PowerPoint, CSV or text, 5 MB each). Files are stored in the database (`ticket_files`), checked on upload, and only the business that owns the request and the DSMA team can open them. The new tables are created automatically on the next start.

## Message translation

The Translate button works with no setup, using the free MyMemory service (it detects the source language and translates into the language picked on the site). Optional settings: `TRANSLATE_EMAIL` raises its daily limit from 5,000 to 50,000 characters (it falls back to `CONTACT_TO`); `ANTHROPIC_API_KEY` switches to Claude for higher quality, with the free engine as a backup.
