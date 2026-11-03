"use client";

// A change the copilot suggested, shown in AI mode: what it will do, editable
// where that helps (an email draft), and done only when the person confirms.
import clsx from "clsx";
import { ArrowUpRight, Boxes, CalendarDays, Check, Contact, FolderInput, Handshake, Loader2, Mail, Receipt, ReceiptText, Building2, UserPlus, ListTodo, StickyNote, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";

/** "Send all": confirms each of these suggestions, as its own card's button would (with the edits made in it). */
export const CONFIRM_ALL = "cc-copilot-confirm-all";
export const confirmAll = (ids: string[]) => window.dispatchEvent(new CustomEvent(CONFIRM_ALL, { detail: ids }));

export type CopilotAction = { id: string; kind: string; summary: string; label: string; status: string; error?: string | null; result?: { id: string; link: string } | null; input: Record<string, unknown> };

const ICON: Record<string, LucideIcon> = { send_email: Mail, calendar_event: CalendarDays, crm_contact: Contact, crm_deal: Handshake, invoice_draft: ReceiptText, business_profile: Building2, invite_member: UserPlus, record_bill: Receipt, inventory_items: Boxes, save_document: FolderInput, crm_task: ListTodo, work_task: ListTodo, crm_note: StickyNote };
const TONE: Record<string, string> = { send_email: "#4f5ef7", calendar_event: "#8b7bff", crm_contact: "#3ccf91", crm_deal: "#f5a35c", invoice_draft: "#2ec4b6", business_profile: "#ff7a59", invite_member: "#4fb3ff", record_bill: "#3ccf91", inventory_items: "#f5a35c", save_document: "#8b7bff" };
const CONFIRM: Record<string, string> = { send_email: "Send email", calendar_event: "Add to calendar", crm_contact: "Add contact", crm_deal: "Add deal", invoice_draft: "Save draft invoice", business_profile: "Save details", invite_member: "Send invitation", record_bill: "Save to Accounts", inventory_items: "Add to inventory", save_document: "Save to Documents" };

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
    case "record_bill": {
      const d = (i.draft ?? {}) as { supplierName?: string; supplierGstin?: string; billNo?: string; date?: string; dueDate?: string | null; lines?: { description: string; amount: number; gstRate: number }[] };
      const lines = d.lines ?? [];
      const sub = lines.reduce((t, l) => t + l.amount, 0) / 100;
      const tax = lines.reduce((t, l) => t + Math.round((l.amount * l.gstRate) / 100), 0) / 100;
      return [
        ["Type", i.kind === "expense" ? "Expense (already paid)" : "Bill to pay"],
        ["Supplier", [d.supplierName, d.supplierGstin].filter(Boolean).join(" · ") || "—"],
        ...(d.billNo ? [["Bill no.", d.billNo] as [string, string]] : []),
        ["Date", [d.date, d.dueDate ? `due ${d.dueDate}` : ""].filter(Boolean).join(" · ")],
        ...lines.slice(0, 8).map((l) => [`${l.description || "Line"}${l.gstRate ? ` · GST ${l.gstRate}%` : ""}`, rupees(l.amount / 100)] as [string, string]),
        ["GST", rupees(tax)],
        ["Total", rupees(sub + tax)],
      ];
    }
    case "inventory_items": {
      const items = (i.items ?? []) as { name: string; unit?: string; gstRate?: number; cost?: number }[];
      return [...items.slice(0, 10).map((x) => [x.name, [x.cost ? rupees(x.cost) : "", x.unit ?? "pcs", `GST ${x.gstRate ?? 18}%`].filter(Boolean).join(" · ")] as [string, string]), ...(items.length > 10 ? [["…", `${items.length - 10} more`] as [string, string]] : [])];
    }
    case "save_document":
      return [["Title", String(i.title ?? "")], ...(i.description ? [["Note", String(i.description)] as [string, string]] : [])];
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
  const latest = useRef(confirm);
  const live = useRef(open);
  useEffect(() => {
    latest.current = confirm;
    live.current = open && !busy;
  });
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string[]>).detail.includes(action.id) && live.current) void latest.current();
    };
    window.addEventListener(CONFIRM_ALL, on);
    return () => window.removeEventListener(CONFIRM_ALL, on);
  }, [action.id]);
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

      {action.kind === "record_bill" && Array.isArray(action.input.warnings) && action.input.warnings.length > 0 && (
        <div className="ai-warn">
          {(action.input.warnings as string[]).map((w, i) => (
            <span key={i}>⚠ {w}</span>
          ))}
        </div>
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
