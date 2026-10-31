import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/safe-next";

// Sign-up moved to /start (onboarding first, then an emailed code). Old links
// keep working: a business page's industry and any other "next" carry over.
export default async function Page({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  const next = typeof sp.next === "string" ? safeNextPath(sp.next, "") || null : null;
  // /signup?next=/welcome?industry=clinic → /start?industry=clinic (/start is the welcome flow now).
  const fromWelcome = next?.startsWith("/welcome") ? new URLSearchParams(next.split("?")[1] ?? "").get("industry") : null;
  const industry = typeof sp.industry === "string" ? sp.industry : fromWelcome;
  if (industry) q.set("industry", industry);
  if (next && !next.startsWith("/welcome")) q.set("next", next);
  redirect(`/start${q.size ? `?${q}` : ""}`);
}
