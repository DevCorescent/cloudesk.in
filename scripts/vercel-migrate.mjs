// Runs before every Vercel build (package.json "vercel-build"): a production
// build first applies the pending SQL migrations, so the code that goes live
// never meets a database without its tables and columns. If a migration
// fails, the build fails and the current deployment keeps serving.
//
// Preview builds skip it: they'd otherwise apply a branch's unmerged
// migrations to the production database. Migrations use the direct
// (non-pooled) connection; Neon's pooler is in transaction mode.
//   node scripts/vercel-migrate.mjs
if (process.env.VERCEL_ENV !== "production") {
  console.log(`vercel-migrate: skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`);
  process.exit(0);
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!url) {
  console.error("vercel-migrate: no database URL in this build's environment");
  process.exit(1);
}
process.env.DATABASE_URL = url;
console.log("vercel-migrate: applying migrations");
await import("./migrate.mjs");
