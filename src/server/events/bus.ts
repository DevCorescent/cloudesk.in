// One place where project events go out: automations, outgoing webhooks
// (including installed apps) and built-in integrations. Emitting never
// throws into the caller; the work itself runs in the job queue.
import { randomToken } from "../security/tokens";
import { emitWorkflowEvent } from "../automation/workflows";
import { log } from "../log";
import type { EventType } from "@/lib/platform/events";
import { captureFromEvent } from "../crm/capture";
import { fanOutIntegrations } from "./integrations";
import { fanOutWebhooks, type EventEnvelope } from "./webhooks";

const WORKFLOW_TRIGGER: Partial<Record<EventType, "form_submitted" | "order_placed" | "order_paid" | "booking_confirmed">> = {
  "form.submitted": "form_submitted",
  "order.placed": "order_placed",
  "order.paid": "order_paid",
  "booking.confirmed": "booking_confirmed",
};

export async function emitEvent(projectId: string, type: EventType, data: Record<string, unknown>) {
  const evt: EventEnvelope = { id: `evt_${randomToken(12)}`, type, createdAt: new Date().toISOString(), projectId, data };
  const trigger = WORKFLOW_TRIGGER[type];
  if (trigger) await emitWorkflowEvent(projectId, trigger, data);
  await fanOutWebhooks(evt).catch((e) => log.warn("webhook_fanout_failed", { projectId, type, error: (e as Error).message }));
  await fanOutIntegrations(evt).catch((e) => log.warn("integration_fanout_failed", { projectId, type, error: (e as Error).message }));
  await captureFromEvent(projectId, type, data).catch((e) => log.warn("crm_capture_failed", { projectId, type, error: (e as Error).message }));
  return evt;
}
