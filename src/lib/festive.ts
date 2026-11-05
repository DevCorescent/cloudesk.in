// Festive touches on the marketing site, and the launch offer that goes with
// them. Diwali 2026 is Sunday 8 November: the lights go up a week before and
// come down a week after. The launch & Diwali offer — three months of every
// feature, free — is for workspaces started by the end of 10 November (IST).

export const DIWALI = { from: "2026-11-01T00:00:00+05:30", to: "2026-11-16T00:00:00+05:30" };
export const LAUNCH_OFFER = { until: "2026-11-11T00:00:00+05:30", trialDays: 90, label: "3 months", lastDay: "10 November" };

/** Whether it's Diwali time at this moment. */
export function isDiwali(now: Date = new Date()) {
  return now >= new Date(DIWALI.from) && now < new Date(DIWALI.to);
}

/** The launch offer, while it runs. Tests keep the standard trial (so their dates don't depend on the calendar) unless they turn it on. */
export function launchOffer(now: Date = new Date()) {
  if (process.env.VITEST && process.env.FESTIVE_OFFER !== "on") return null;
  return now < new Date(LAUNCH_OFFER.until) ? LAUNCH_OFFER : null;
}

/** How long the free trial is for someone starting now, in words. */
export const freeFor = () => (launchOffer() ? "3 months" : "30 days");
