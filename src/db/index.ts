import { readFileSync } from "node:fs";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __ccPool?: Pool; __ccDb?: Db };

/**
 * TLS to the database. DATABASE_SSL_CA names a CA bundle (the image ships Amazon's
 * at /app/certs/rds-global-bundle.pem) and the server's certificate is verified.
 * DATABASE_SSL=no-verify encrypts without verifying — only for providers that
 * don't publish a CA. Unset: plain, for a database on the same private network.
 */
function sslConfig(): PoolConfig["ssl"] {
  const ca = process.env.DATABASE_SSL_CA;
  if (ca) return { ca: readFileSync(ca, "utf8"), rejectUnauthorized: true };
  if (process.env.DATABASE_SSL === "no-verify") return { rejectUnauthorized: false };
  return undefined;
}

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  // Each process also opens two LISTEN clients (chat, documents) outside this pool.
  // Size DB_POOL_MAX × instances to stay under the database's max_connections.
  const ssl = sslConfig();
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX) || 10,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 15_000,
    idleTimeoutMillis: 30_000,
    ...(ssl ? { ssl } : {}),
  });
  globalForDb.__ccPool = pool;
  return drizzle(pool, { schema });
}

// Reuse one pool across hot reloads in development.
export const db: Db = new Proxy({} as Db, {
  get(_t, prop) {
    globalForDb.__ccDb ??= createDb();
    return Reflect.get(globalForDb.__ccDb, prop);
  },
});

export async function closeDb() {
  await globalForDb.__ccPool?.end();
  globalForDb.__ccPool = undefined;
  globalForDb.__ccDb = undefined;
}

export { schema };
