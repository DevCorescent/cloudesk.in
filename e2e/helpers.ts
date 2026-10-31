import type { Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";

// Shared helpers. People sign up at /start with an emailed code (journey.spec
// covers that end to end); other specs only need a signed-in account, so they
// create one directly (the E2E server allows it with ALLOW_DIRECT_SIGNUP=1).
config({ path: ".env.local", quiet: true });

export const PASSWORD = "correct-horse-42";
let n = 1;

/** Creates an account, signs the page in and opens /welcome, as the old sign-up form did. */
export async function signUp(page: Page, name: string, email: string, password = PASSWORD) {
  // Each test account comes from its own address, so the sign-up rate limit (10 an hour per address) isn't hit by the suite.
  const ip = `10.${(n >> 8) & 255}.${n++ & 255}.${Math.floor(Math.random() * 250) + 1}`;
  const res = await page.request.post("/api/v1/auth/signup", { data: { name, email, password }, headers: { origin: "http://localhost:3100", "x-forwarded-for": ip } });
  if (!res.ok()) throw new Error(`Sign-up failed (${res.status()}): ${await res.text()}`);
  await page.goto("/welcome");
  await page.waitForURL(/\/welcome$/);
}

let pool: Pool | null = null;

/** The six-digit code in the newest email to this address (read from the outbox). */
export async function codeFor(email: string, after = new Date(0)) {
  pool ??= new Pool({ connectionString: process.env.E2E_DATABASE_URL });
  for (let i = 0; i < 40; i++) {
    const r = await pool.query<{ subject: string }>("select subject from outbound_emails where lower(\"to\") = lower($1) and created_at > $2 order by created_at desc limit 1", [email, after]);
    const m = r.rows[0] && /(\d{6})/.exec(r.rows[0].subject);
    if (m) return m[1]!;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`No code emailed to ${email}`);
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}
