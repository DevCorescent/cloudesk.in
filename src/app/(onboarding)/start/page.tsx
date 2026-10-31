import type { Metadata } from "next";
import { StartView, type Preselect } from "@/components/onboarding/start-view";
import { safeNextPath } from "@/lib/safe-next";
import { industryById, MODULE_IDS, type ModuleId } from "@/lib/workspace/modules";
import { settings } from "@/server/platform/settings";

export const metadata: Metadata = { title: "Start free" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined);

// Public sign-up: onboarding first, then the account and an emailed code.
// ?industry= comes from a business page; ?plan= / ?build=&seats= / ?interval= from /pricing.
// Anything that doesn't check out is ignored.
export default async function Page({ searchParams }: PageProps<"/start">) {
  const sp = await searchParams;
  const interval = one(sp.interval);
  const plan = one(sp.plan)?.trim();
  const build = one(sp.build)
    ?.split(",")
    .map((m) => m.trim())
    .filter((m): m is ModuleId => (MODULE_IDS as string[]).includes(m));
  const seats = Number(one(sp.seats));
  const preselect: Preselect = {
    plan: plan && /^[a-z0-9_-]{1,40}$/i.test(plan) ? plan : null,
    build: !plan && build?.length ? [...new Set(build)] : null,
    seats: Number.isInteger(seats) && seats > 0 && seats <= 10000 ? seats : null,
    interval: interval === "month" || interval === "year" ? interval : null,
  };
  const next = one(sp.next);
  // Legal links: the platform's own (Admin → Settings → General) if set, else the built-in /terms and /privacy.
  const general = await settings().then((s) => s.general, () => null);
  return <StartView industry={industryById(one(sp.industry))?.id ?? null} preselect={preselect} next={safeNextPath(next, "") || null} termsUrl={general?.termsUrl || "/terms"} privacyUrl={general?.privacyUrl || "/privacy"} />;
}
