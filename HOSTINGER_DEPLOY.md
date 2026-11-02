# Hostinger deployment

This is a Node/Express application with a plain HTML/CSS/JavaScript frontend and a MySQL backend.

## Hostinger Node.js deployment

This replaces the files in your existing DSMA Node.js app. Keep the current domain, Node.js application, database, and environment variables; do not create a second Hostinger app.

1. In the Git repository already connected to the DSMA Hostinger app, replace the project contents with this folder's contents and push the update. If you upload a ZIP instead, extract its contents directly into that app's existing project directory so `package.json` and `server.js` stay at the root.
2. In the deployment settings, choose **Express.js**, set the root directory to `./`, choose **npm**, and use Node.js 22 or 24 (20 or newer is required).
3. Set the build command to `npm run build` and the entry file/start command to `server.js` / `npm start`. Do not use `npm start` as the build command: it starts the server and never exits, causing a deployment to appear stuck.
4. Leave the output directory blank—Express serves the files directly and does not produce a `dist` folder.
5. Keep your existing production environment variables and MySQL database. Ensure `DEMO_MODE=false` and use a real `SESSION_SECRET` of at least 32 characters.
6. Run the normal deploy/restart action in the same Hostinger Node.js app.
7. First start: the server now creates its own tables. To create the first DSMA team login, set `TEAM_EMAIL` and `TEAM_PASSWORD` (8+ characters, optionally `TEAM_NAME`) in the environment settings and restart; once you can sign in, delete `TEAM_PASSWORD`. `database/schema.sql` and `tools/create-team.js` still work if you prefer doing it by hand.

## Contact form emails

Every contact-form message is saved to MySQL and also emailed to `dsmaservicesbps@gmail.com` (change it with `CONTACT_TO`). The reply button in your mail app answers the sender, because their address is the Reply-To.

1. The new `nodemailer` package is already listed in `package.json` and `package-lock.json`, so the normal install on deploy picks it up (Node 20 or newer).
2. Create a Gmail **App password**: turn on 2-Step Verification for the account, then Google Account > Security > App passwords. Copy the 16 characters.
3. In Hostinger's Node.js app, add these environment variables (see `.env.example`): `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=dsmaservicesbps@gmail.com`, `SMTP_PASS=<the app password>`. Restart the app.
4. The startup log says "Contact form emails go to ..." when it is on. Send a test message from the site.

If the email step fails, the visitor still sees "message sent" (the message is safe in the database) and the error is written to the server log. A Hostinger mailbox also works: use `smtp.hostinger.com`, port 465, and that mailbox's address and password.

## Do not use

Do not use Hostinger Website Builder for this version; it cannot run the Express API or MySQL sessions. Do not upload only `index.html`; the Node server and `package.json` are required.

