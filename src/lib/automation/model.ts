// Workflow definitions, shared by the editor and the engine.
import { z } from "zod";

export const TRIGGER_TYPES = ["form_submitted", "order_placed", "order_paid", "booking_confirmed", "schedule", "webhook", "manual"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const TRIGGER_INFO: Record<TriggerType, { label: string; description: string; fields: string[] }> = {
  form_submitted: { label: "A form is submitted", description: "Contact and booking forms on the published site.", fields: ["formId", "page", "data.name", "data.email", "data.message"] },
  order_placed: { label: "An order is placed", description: "Any new store order, before payment.", fields: ["number", "email", "total", "currency", "paymentMethod", "customerName"] },
  order_paid: { label: "An order is paid", description: "Payment confirmed by the provider (or marked paid).", fields: ["number", "email", "total", "currency", "customerName"] },
  booking_confirmed: { label: "A booking is confirmed", description: "Free bookings when made; paid bookings once paid.", fields: ["service", "name", "email", "startsAt", "partySize"] },
  schedule: { label: "On a schedule", description: "Cron schedule in your time zone, e.g. every Monday at 9:00.", fields: ["scheduledFor"] },
  webhook: { label: "A webhook is called", description: "Another service POSTs JSON to a secret URL.", fields: ["body", "query"] },
  manual: { label: "Run manually", description: "Started with the Run button (with test data).", fields: ["input"] },
};

export const STEP_TYPES = ["send_email", "http_request", "slack", "delay", "condition"] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const STEP_INFO: Record<StepType, { label: string; description: string }> = {
  send_email: { label: "Send an email", description: "To a teammate, or to the customer from the trigger." },
  http_request: { label: "Call a URL", description: "Send data to another service (public addresses only)." },
  slack: { label: "Post to Slack", description: "Via a Slack incoming-webhook URL." },
  delay: { label: "Wait", description: "Pause before the next step (up to 30 days)." },
  condition: { label: "Only continue if…", description: "Stop the run unless a condition holds." },
};

const tpl = (max: number) => z.string().max(max);

export const stepSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1).max(40), type: z.literal("send_email"), config: z.object({ to: tpl(300), subject: tpl(200), body: tpl(10_000) }) }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal("http_request"),
    config: z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      url: tpl(2000),
      headers: z.record(z.string().max(100), tpl(2000)).default({}),
      body: tpl(20_000).default(""),
      /** 4xx responses fail the step immediately instead of retrying. */
      failOn4xx: z.boolean().default(true),
    }),
  }),
  z.object({ id: z.string().min(1).max(40), type: z.literal("slack"), config: z.object({ text: tpl(3000) }) }),
  z.object({ id: z.string().min(1).max(40), type: z.literal("delay"), config: z.object({ amount: z.number().int().min(1).max(43_200), unit: z.enum(["minutes", "hours", "days"]) }) }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal("condition"),
    config: z.object({ left: tpl(500), op: z.enum(["equals", "not_equals", "contains", "not_contains", "gt", "lt", "exists", "not_exists"]), right: tpl(500).default("") }),
  }),
]);
export type Step = z.infer<typeof stepSchema>;

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("form_submitted"), config: z.object({ formId: z.string().max(64).default("") }).default({ formId: "" }) }),
  z.object({ type: z.literal("order_placed"), config: z.object({}).default({}) }),
  z.object({ type: z.literal("order_paid"), config: z.object({}).default({}) }),
  z.object({ type: z.literal("booking_confirmed"), config: z.object({}).default({}) }),
  z.object({ type: z.literal("schedule"), config: z.object({ cron: z.string().min(9).max(100), timezone: z.string().min(1).max(64) }) }),
  z.object({ type: z.literal("webhook"), config: z.object({}).default({}) }),
  z.object({ type: z.literal("manual"), config: z.object({}).default({}) }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

export const MAX_STEPS = 20;
export const workflowInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: triggerSchema,
  steps: z.array(stepSchema).max(MAX_STEPS),
  /** name → value; values are encrypted at rest and never returned. Empty string keeps the stored value. */
  secrets: z.record(z.string().regex(/^[a-zA-Z][\w]{0,39}$/), z.string().max(2000)).default({}),
});

// ─── Templates: {{path.to.value}} only, no code ──────────────────────────────

export type TemplateScope = Record<string, unknown>;

export function lookup(scope: TemplateScope, path: string): unknown {
  let cur: unknown = scope;
  for (const part of path.split(".")) {
    // Own properties only: no reaching into prototypes ("constructor", "__proto__").
    if (cur === null || cur === undefined || typeof cur !== "object" || !Object.hasOwn(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const asText = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/**
 * Fills {{placeholders}}. In "json" mode values are escaped for use inside a
 * JSON string, so data from a form can't break out of the request body.
 */
export function renderTemplate(tplText: string, scope: TemplateScope, mode: "text" | "json" = "text"): string {
  return tplText.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, path: string) => {
    const s = asText(lookup(scope, path));
    return mode === "json" ? JSON.stringify(s).slice(1, -1) : s;
  });
}

/** Placeholder paths a template uses (for checks and the editor). */
export const templatePaths = (t: string) => [...t.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]);

export function evaluateCondition(c: Extract<Step, { type: "condition" }>["config"], scope: TemplateScope): boolean {
  const l = renderTemplate(c.left, scope).trim();
  const r = renderTemplate(c.right, scope).trim();
  switch (c.op) {
    case "equals":
      return l.toLowerCase() === r.toLowerCase();
    case "not_equals":
      return l.toLowerCase() !== r.toLowerCase();
    case "contains":
      return l.toLowerCase().includes(r.toLowerCase());
    case "not_contains":
      return !l.toLowerCase().includes(r.toLowerCase());
    case "gt":
      return l !== "" && r !== "" && Number(l) > Number(r);
    case "lt":
      return l !== "" && r !== "" && Number(l) < Number(r);
    case "exists":
      return l !== "";
    case "not_exists":
      return l === "";
  }
}

export const delayMs = (c: Extract<Step, { type: "delay" }>["config"]) => c.amount * (c.unit === "minutes" ? 60_000 : c.unit === "hours" ? 3600_000 : 86400_000);
