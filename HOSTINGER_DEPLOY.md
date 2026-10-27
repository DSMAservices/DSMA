# Hostinger deployment

This is a Node/Express application with a plain HTML/CSS/JavaScript frontend and a MySQL backend.

## Hostinger Node.js deployment

This replaces the files in your existing DSMA Node.js app. Keep the current domain, Node.js application, database, and environment variables; do not create a second Hostinger app.

1. In the Git repository already connected to the DSMA Hostinger app, replace the project contents with this folder's contents and push the update. If you upload a ZIP instead, extract its contents directly into that app's existing project directory so `package.json` and `server.js` stay at the root.
2. In the deployment settings, choose **Express.js**, set the root directory to `./`, choose **npm**, and use Node.js 22 or 24.
3. Set the build command to `npm run build` and the entry file/start command to `server.js` / `npm start`. Do not use `npm start` as the build command: it starts the server and never exits, causing a deployment to appear stuck.
4. Leave the output directory blank—Express serves the files directly and does not produce a `dist` folder.
5. Keep your existing production environment variables and MySQL database. Ensure `DEMO_MODE=false` and use a real `SESSION_SECRET` of at least 32 characters.
6. Run the normal deploy/restart action in the same Hostinger Node.js app.
7. If this is your first live deployment, import `database/schema.sql` and run `node tools/create-team.js ...` once to create the first DSMA team login. If the existing main site already has this database and team account, skip this step.

## Do not use

Do not use Hostinger Website Builder for this version; it cannot run the Express API or MySQL sessions. Do not upload only `index.html`; the Node server and `package.json` are required.

