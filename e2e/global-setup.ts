import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Every run starts from a migrated, empty database.
export default async function globalSetup() {
  config({ path: ".env.local", quiet: true });
  const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.query("truncate table users, organizations, sessions, auth_tokens, outbound_emails, audit_logs, platform_settings, platform_config, rate_limits, request_stats, platform_snapshots cascade");
  await pool.end();
}
