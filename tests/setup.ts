import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
// Integration tests always run against the dedicated test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_URL = "http://localhost:3000";
process.env.ANTHROPIC_API_KEY = "";
