require("dotenv").config();
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

async function main() {
  if (process.argv.length !== 5) throw new Error('Usage: node tools/create-team.js "Team member" email@example.com password');
  if (process.argv[4].length < 8) throw new Error("Password must be at least 8 characters.");
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, charset: "utf8mb4" });
  await db.execute("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'team')", [process.argv[2], process.argv[3].trim().toLowerCase(), await bcrypt.hash(process.argv[4], 12)]);
  await db.end();
  console.log("Team account created.");
}
main().catch((error) => { console.error(error.message); process.exit(1); });
