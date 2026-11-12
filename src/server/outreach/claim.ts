// The sign-up side of exact attribution, kept small so the sign-up routes
// don't load the whole outreach engine. Never fails a sign-up.
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { log } from "../log";

export async function claimOutreach(email: string, token: string | null | undefined) {
  if (!token) return;
  try {
    const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
    if (u) await (await import("./core")).claimSignup(u.id, token);
  } catch (e) {
    log.warn("outreach.claim_failed", { err: String(e) });
  }
}
