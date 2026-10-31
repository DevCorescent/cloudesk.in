// Applies the SQL migrations in ./drizzle. Plain JavaScript on purpose: it runs
// inside the production image, which has no tsx or dotenv.
//   node scripts/migrate.mjs            uses DATABASE_URL
//   node scripts/migrate.mjs --test     uses TEST_DATABASE_URL
// Reads .env.local when it exists (development); the environment always wins.
import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const url = process.argv.includes("--test") ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error("Database URL not set");

// The same TLS rules as src/db/index.ts: a CA bundle verifies the server; "no-verify" only encrypts.
const ca = process.env.DATABASE_SSL_CA;
const ssl = ca ? { ca: readFileSync(ca, "utf8"), rejectUnauthorized: true } : process.env.DATABASE_SSL === "no-verify" ? { rejectUnauthorized: false } : undefined;

const pool = new pg.Pool({ connectionString: url, max: 2, ...(ssl ? { ssl } : {}) });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
await pool.end();
console.log("migrations applied");
