"use client";

// A change the copilot suggested, shown in AI mode: what it will do, editable
// where that helps (an email draft), and done only when the person confirms.
import clsx from "clsx";
import { ArrowUpRight, CalendarDays, Check, Contact, Handshake, Loader2, Mail, ReceiptText, Building2, UserPlus, ListTodo, StickyNote, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";

export type CopilotAction = { id: string; kind: string; summary: string; label: string; status: string; error?: string | null; result?: { id: string; link: string } | null; input: Record<string, unknown> };

const ICON: Record<string, LucideIcon> = { send_email: Mail, calendar_event: CalendarDays, crm_contact: Contact, crm_deal: Handshake, invoice_draft: ReceiptText, business_profile: Building2, invite_member: UserPlus, crm_task: ListTodo, work_task: ListTodo, crm_note: StickyNote };
const TONE: Record<string, string> = { send_email: "#4f5ef7", calendar_event: "#8b7bff", crm_contact: "#3ccf91", crm_deal: "#f5a35c", invoice_draft: "#2ec4b6", business_profile: "#ff7a59", invite_member: "#4fb3ff" };
const CONFIRM: Record<string, string> = { send_email: "Send email", calendar_event: "Add to calendar", crm_contact: "Add contact", crm_deal: "Add deal", invoice_draft: "Save draft invoice", business_profile: "Save details", invite_member: "Send invitation" };

const list = (v: unknown) => (Array.isArray(v) ? (v as string[]).join(", ") : "");
const emails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const ist = (iso: unknown) => (typeof iso === "string" ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** The details worth seeing before confirming, as label/value rows. */
function rows(a: CopilotAction): [string, string][] {
  const i = a.input;
  switch (a.kind) {
    case "calendar_event":
      return [["When", `${ist(i.start)} – ${typeof i.end === "string" ? new Date(i.end).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" }) : ""}`], ["Title", String(i.title ?? "")], ...(i.location ? [["Where", String(i.location)] as [string, string]] : []), ...(Array.isArray(i.attendees) && i.attendees.length ? [["Guests", (i.attendees as { email: string }[]).map((x) => x.email).join(", ")] as [string, string]] : []), ...(i.sendInvite ? [["Invites", "Emailed to guests"] as [string, string]] : [])];
    case "crm_contact":
      return [["Name", String(i.name ?? "")], ...(["email", "phone", "companyName", "title"] as const).filter((k) => i[k]).map((k) => [k === "companyName" ? "Company" : k[0]!.toUpperCase() + k.slice(1), String(i[k])] as [string, string])];
    case "crm_deal":
      return [["Deal", String(i.title ?? "")], ["Value", rupees(Number(i.value ?? 0))], ...(i.expectedClose ? [["Expected close", String(i.expectedClose)] as [string, string]] : [])];
    case "invoice_draft": {
      const c = (i.client ?? {}) as Record<string, string>;
      const lines = (i.lines ?? []) as { name: string; quantity: number; rate: number; taxPercent?: number }[];
      const sub = lines.reduce((t, l) => t + l.quantity * l.rate, 0);
      const tax = lines.reduce((t, l) => t + (l.quantity * l.rate * (l.taxPercent ?? 18)) / 100, 0);
      return [["Client", [c.name, c.company].filter(Boolean).join(" · ")], ...lines.map((l) => [`${l.quantity} × ${l.name}`, rupees(l.quantity * l.rate)] as [string, string]), ["GST", rupees(tax)], ["Total", rupees(sub + tax)]];
    }
    case "business_profile": {
      const ad = i.address as Record<string, string> | undefined;
      const r: [string, string][] = [];
      const add = (k: string, label: string) => i[k] && r.push([label, String(i[k])]);
      add("legalName", "Legal name");
      add("gstin", "GSTIN");
      add("pan", "PAN");
      if (ad) r.push(["Address", [ad.line1, ad.line2, ad.city, ad.state, ad.postalCode].filter(Boolean).join(", ")]);
      add("phone", "Phone");
      add("email", "Email");
      add("website", "Website");
      add("upiId", "UPI ID");
      return r;
    }
    case "invite_member":
      return [["Email", String(i.email ?? "")], ["Role", String(i.role ?? "editor")]];
    default:
      return [];
  }
}

export function ActionCard({ orgId, action }: { orgId: string; action: CopilotAction }) {
  const [state, setState] = useState<{ status: string; link?: string; error?: string }>({ status: action.status, link: action.result?.link, error: action.error ?? undefined });
  const [busy, setBusy] = useState<"confirm" | "dismiss" | null>(null);
  const mail = action.kind === "send_email";
  const [to, setTo] = useState(list(action.input.to));
  const [cc, setCc] = useState(list(action.input.cc));
  const [subject, setSubject] = useState(String(action.input.subject ?? ""));
  const [body, setBody] = useState(String(action.input.body ?? ""));
  const Icon = ICON[action.kind] ?? Check;
  const open = state.status === "proposed" || state.status === "failed";

  const confirm = async () => {
    setBusy("confirm");
    try {
      const r = await api<{ link: string }>(`/api/v1/orgs/${orgId}/copilot/actions/${action.id}/confirm`, { method: "POST", body: mail ? { input: { to: emails(to), cc: emails(cc), subject, body } } : {} });
      setState({ status: "done", link: r.link });
    } catch (e) {
      setState({ status: "failed", error: e instanceof ApiClientError ? e.message : errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const dismiss = async () => {
    setBusy("dismiss");
    try {
      await api(`/api/v1/orgs/${orgId}/copilot/actions/${action.id}/dismiss`, { method: "POST" });
      setState({ status: "dismissed" });
    } catch (e) {
      setState((x) => ({ ...x, error: errorMessage(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={clsx("ai-act", !open && "is-closed")} style={{ "--tone": TONE[action.kind] ?? "#4f5ef7" } as React.CSSProperties}>
      <div className="ai-act-h">
        <span className="ai-act-ic">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <b>{mail ? (state.status === "done" ? "Email sent" : "Email draft") : action.label}</b>
          <small>{action.summary}</small>
        </span>
        {state.status === "done" && <span className="ai-act-badge">Done</span>}
        {state.status === "dismissed" && <span className="ai-act-badge is-muted">Dismissed</span>}
      </div>

      {mail ? (
        <div className="ai-mail">
          <label>
            <span>To</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} disabled={!open} inputMode="email" autoCapitalize="none" spellCheck={false} />
          </label>
          {(cc || open) && (
            <label>
              <span>Cc</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} disabled={!open} inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="Optional" />
            </label>
          )}
          <label>
            <span>Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!open} />
          </label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!open} rows={Math.min(14, Math.max(5, body.split("\n").length + 1))} aria-label="Email body" />
        </div>
      ) : (
        rows(action).length > 0 && (
          <div className="ai-rows">
            {rows(action).map(([k, v], i) => (
              <div key={i} className="ai-row">
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
        )
      )}

      {state.error && <p className="ai-err">{state.error}</p>}
      {open ? (
        <div className="ai-acts">
          <button type="button" className="ai-btn" disabled={!!busy} onClick={() => void confirm()}>
            {busy === "confirm" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {state.status === "failed" ? "Try again" : (CONFIRM[action.kind] ?? "Confirm")}
          </button>
          <button type="button" className="ai-btn-ghost" disabled={!!busy} onClick={() => void dismiss()}>
            <X className="size-4" /> {mail ? "Discard" : "Dismiss"}
          </button>
        </div>
      ) : (
        state.status === "done" &&
        state.link && (
          <Link href={state.link} className="ai-link">
            <span>Open it</span>
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        )
      )}
    </div>
  );
}
