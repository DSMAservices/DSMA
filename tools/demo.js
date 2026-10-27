const crypto = require("crypto");

// An isolated, in-memory preview. These accounts are never enabled by npm start.
process.env.NODE_ENV = "development";
process.env.DEMO_MODE = "true";
process.env.DEMO_LOCAL_ONLY = "true";
process.env.SESSION_SECRET = crypto.randomBytes(48).toString("hex");
process.env.PORT ||= "3000";

require("../server");
