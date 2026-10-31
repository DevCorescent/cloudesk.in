// Platform plans. Limits apply only when billing is configured; a self-hosted
// install without billing keys is unlimited.
export const PLAN_IDS = ["free", "pro", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type Limits = { projects: number; seats: number; customDomains: number; automationsPerProject: number };

export const PLANS: Record<PlanId, { name: string; tagline: string; limits: Limits; features: string[] }> = {
  free: { name: "Free", tagline: "Try it out", limits: { projects: 3, seats: 3, customDomains: 0, automationsPerProject: 3 }, features: ["3 projects", "3 team members", "Platform address (/s/…)", "3 automations per project"] },
  pro: { name: "Pro", tagline: "For a growing business", limits: { projects: 20, seats: 10, customDomains: 5, automationsPerProject: 25 }, features: ["20 projects", "10 team members", "5 custom domains", "25 automations per project", "Priority email support"] },
  business: { name: "Business", tagline: "For teams and agencies", limits: { projects: 100, seats: 50, customDomains: 50, automationsPerProject: 50 }, features: ["100 projects", "50 team members", "50 custom domains", "50 automations per project", "Require two-factor for the team"] },
};

export const UNLIMITED: Limits = { projects: Infinity, seats: Infinity, customDomains: Infinity, automationsPerProject: Infinity };
export const isPlanId = (v: unknown): v is PlanId => PLAN_IDS.includes(v as PlanId);
