"use client";

// CRM: shared client pieces — the workspace context (pipelines, owners, fields,
// what you're allowed to do), API hooks, money and dates, and small parts used
// on every screen (avatars, lifecycle and score badges, owner and tag pickers,
// custom field inputs).
import { useModules } from "@/components/shell/use-modules";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/overlays";
import { cx, Input, Select, Switch } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { LIFECYCLE_LABEL, type CrmSettings, type Lifecycle } from "@/lib/crm/model";
import { formatPrice } from "@/lib/store/money";

export type Stage = { id: string; name: string; probability: number; kind: "open" | "won" | "lost"; rotDays: number; sort: number; pipelineId: string };
export type Pipeline = { id: string; name: string; stages: Stage[] };
export type Owner = { id: string; name: string; email: string; canOwn: boolean };
export type Field = { id: string; entity: "contact" | "company" | "deal"; key: string; label: string; type: "text" | "number" | "date" | "select" | "checkbox" | "url"; options: string[] };
export type Meta = {
  me: { id: string; role: string; manage: boolean; write: boolean; own: boolean };
  settings: CrmSettings & { captureUrl: string | null };
  pipelines: Pipeline[];
  fields: Field[];
  owners: Owner[];
  tags: { tag: string; n: number }[];
  mail: "outbox" | "live";
};
export type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  companyId: string | null;
  company?: string;
  ownerId: string | null;
  lifecycle: Lifecycle;
  leadStatus: string;
  source: string;
  score: number;
  tags: string[];
  custom: Record<string, unknown>;
  city: string;
  country: string;
  marketing: boolean;
  doNotContact: boolean;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  openDeals?: number;
};
export type Activity = {
  id: string;
  kind: "note" | "call" | "email" | "meeting" | "task" | "event";
  subject: string;
  body: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  ownerId: string | null;
  dueAt: string | null;
  doneAt: string | null;
  outcome: string;
  durationMin: number | null;
  priority: string;
  meta: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  contact?: string;
  deal?: string;
  company?: string;
};
export type Deal = {
  id: string;
  title: string;
  value: number;
  currency: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  companyId: string | null;
  ownerId: string | null;
  expectedClose: string | null;
  status: "open" | "won" | "lost";
  lostReason: string;
  closedAt: string | null;
  source: string;
  priority: string;
  tags: string[];
  custom: Record<string, unknown>;
  stageEnteredAt: string;
  createdAt: string;
  updatedAt: string;
  contact?: string;
  company?: string;
  stage?: string;
  daysInStage?: number;
  rotting?: boolean;
  nextTask?: string | null;
};

type Ctx = { orgId: string; meta: Meta; base: string; go: (path: string) => void };
const CrmCtx = createContext<Ctx | null>(null);
export const CrmProvider = ({ value, children }: { value: Ctx; children: ReactNode }) => <CrmCtx.Provider value={value}>{children}</CrmCtx.Provider>;
export function useCrm() {
  const c = useContext(CrmCtx);
  if (!c) throw new Error("CRM context missing");
  return c;
}

export const crmApi = (orgId: string, path: string) => `/api/v1/orgs/${orgId}/crm/${path}`;

export function useCrmQuery<T>(path: string | null, opts: { refetchInterval?: number; keepPrevious?: boolean } = {}) {
  const { orgId } = useCrm();
  return useQuery({ queryKey: ["crm", orgId, path], queryFn: () => api<T>(crmApi(orgId, path!)), enabled: !!path, refetchInterval: opts.refetchInterval, placeholderData: opts.keepPrevious ? keepPreviousData : undefined });
}

/** A write that refreshes every CRM view and reports problems. */
export function useCrmAction<B = unknown, R = unknown>(fn: (b: B) => { path: string; method?: string; body?: unknown }, opts: { success?: string | ((r: R) => string); onDone?: (r: R) => void; onError?: (e: unknown) => boolean } = {}) {
  const { orgId } = useCrm();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b: B) => {
      const r = fn(b);
      return api<R>(crmApi(orgId, r.path), { method: r.method ?? "POST", body: r.body });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["crm", orgId] });
      if (opts.success) toast({ tone: "success", title: typeof opts.success === "function" ? opts.success(r) : opts.success });
      opts.onDone?.(r);
    },
    onError: (e) => {
      if (opts.onError?.(e)) return;
      toast({ tone: "error", title: errorMessage(e) });
    },
  });
}

export function useMoney() {
  const { meta } = useCrm();
  return (n: number, currency = meta.settings.currency) => formatPrice(n, currency);
}
/** ₹12.5L, ₹3.2Cr — for tight spaces like board columns. */
export function useShortMoney() {
  const { meta } = useCrm();
  return (n: number) => {
    const v = n / 100;
    if (meta.settings.currency !== "INR") return new Intl.NumberFormat("en", { style: "currency", currency: meta.settings.currency, notation: "compact", maximumFractionDigits: 1 }).format(v);
    if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)}Cr`;
    if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)}L`;
    if (v >= 1e3) return `₹${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
    return `₹${Math.round(v)}`;
  };
}

export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  const fut = s < 0;
  const a = Math.abs(s);
  const t = a < 60 ? "just now" : a < 3600 ? `${Math.floor(a / 60)}m` : a < 86400 ? `${Math.floor(a / 3600)}h` : a < 86400 * 30 ? `${Math.floor(a / 86400)}d` : a < 86400 * 365 ? `${Math.floor(a / (86400 * 30))}mo` : `${Math.floor(a / (86400 * 365))}y`;
  return t === "just now" ? t : fut ? `in ${t}` : `${t} ago`;
}
export const dateLabel = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => (iso ? new Date(iso).toLocaleDateString("en-IN", opts) : "—");
export const timeLabel = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const TONES = ["#6d5dfc", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6"];
export const initials = (n: string) =>
  n
    .split(/[\s@.]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
function hue(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}
export function Avatar({ name, size = 32, square }: { name: string; size?: number; square?: boolean }) {
  return (
    <span aria-hidden className={cx("inline-grid shrink-0 place-items-center font-semibold text-white", square ? "rounded-[10px]" : "rounded-full")} style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: hue(name || "?") }}>
      {initials(name)}
    </span>
  );
}

export const LIFECYCLE_TONE: Record<string, string> = {
  subscriber: "bg-surface-2 text-muted",
  lead: "bg-[#eef2ff] text-[#4338ca] dark:bg-[#312e81]/40 dark:text-[#c7d2fe]",
  qualified: "bg-[#e0f2fe] text-[#0369a1] dark:bg-[#0c4a6e]/40 dark:text-[#bae6fd]",
  opportunity: "bg-[#fef3c7] text-[#92400e] dark:bg-[#78350f]/40 dark:text-[#fde68a]",
  customer: "bg-[#dcfce7] text-[#166534] dark:bg-[#14532d]/40 dark:text-[#bbf7d0]",
  evangelist: "bg-[#fce7f3] text-[#9d174d] dark:bg-[#831843]/40 dark:text-[#fbcfe8]",
  other: "bg-surface-2 text-muted",
};
export function LifecycleBadge({ value }: { value: string }) {
  return <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", LIFECYCLE_TONE[value] ?? LIFECYCLE_TONE.other)}>{LIFECYCLE_LABEL[value as Lifecycle] ?? value}</span>;
}

export function Score({ value }: { value: number }) {
  const tone = value >= 60 ? "text-success" : value >= 30 ? "text-warning" : "text-subtle";
  return (
    <span className="inline-flex items-center gap-1.5" title={`Lead score ${value} of 100`}>
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-surface-2">
        <span className={cx("absolute inset-y-0 left-0 rounded-full", value >= 60 ? "bg-success" : value >= 30 ? "bg-warning" : "bg-border")} style={{ width: `${Math.max(4, value)}%` }} />
      </span>
      <b className={cx("text-[12px] tabular-nums", tone)}>{value}</b>
    </span>
  );
}

export function ownerName(meta: Meta, id: string | null) {
  return meta.owners.find((o) => o.id === id)?.name ?? "Unassigned";
}

export function OwnerSelect({ value, onChange, allowNone = true, label = "Owner", className }: { value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; label?: string; className?: string }) {
  const { meta } = useCrm();
  return (
    <Select aria-label={label} className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">Unassigned</option>}
      {meta.owners
        .filter((o) => o.canOwn || o.id === value)
        .map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.id === meta.me.id ? " (you)" : ""}
          </option>
        ))}
    </Select>
  );
}

export function Tag({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-surface-2 px-2 text-[11.5px] font-medium text-fg/80">
      {children}
      {onRemove && (
        <button type="button" aria-label="Remove tag" onClick={onRemove} className="-mr-0.5 text-subtle hover:text-fg">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/** Type a tag and press Enter; suggestions come from tags already in use. */
export function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { meta } = useCrm();
  const [t, setT] = useState("");
  const add = (tag: string) => {
    const x = tag.trim().slice(0, 40);
    if (x && !value.some((v) => v.toLowerCase() === x.toLowerCase())) onChange([...value, x]);
    setT("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-[12px] border border-border bg-surface px-2 py-1.5 focus-within:border-fg/40">
      {value.map((v) => (
        <Tag key={v} onRemove={() => onChange(value.filter((x) => x !== v))}>
          {v}
        </Tag>
      ))}
      <input
        list="crm-tags"
        aria-label="Add a tag"
        value={t}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(t);
          } else if (e.key === "Backspace" && !t && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => t && add(t)}
        placeholder={value.length ? "" : "Add a tag…"}
        className="min-w-[80px] flex-1 bg-transparent text-[13px] outline-none"
      />
      <datalist id="crm-tags">
        {meta.tags.map((x) => (
          <option key={x.tag} value={x.tag} />
        ))}
      </datalist>
    </div>
  );
}

export function CustomInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: string | number | boolean | null) => void }) {
  const v = value === null || value === undefined ? "" : String(value);
  if (field.type === "select")
    return (
      <Select aria-label={field.label} value={v} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </Select>
    );
  if (field.type === "checkbox")
    return (
      <label className="flex h-9 items-center gap-2 text-[13px]">
        <input type="checkbox" checked={value === true || value === "true"} onChange={(e) => onChange(e.target.checked)} /> Yes
      </label>
    );
  return <Input aria-label={field.label} type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "url" ? "url" : "text"} value={v} onChange={(e) => onChange(field.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />;
}

export function customText(field: Field, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "checkbox") return value === true || value === "true" ? "Yes" : "No";
  if (field.type === "date") return dateLabel(String(value), { day: "numeric", month: "short", year: "numeric" });
  return String(value);
}

export function Stat({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" | "good"; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={cx("rounded-[18px] border border-border bg-surface p-4 text-left shadow-sm", onClick && "transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md")}>
      <p className="text-[12px] font-medium text-muted">{label}</p>
      <p className={cx("mt-1 text-[26px] leading-none font-semibold tracking-[-0.02em] tabular-nums", tone === "warn" && "text-warning", tone === "good" && "text-success")}>{value}</p>
      {sub && <p className="mt-1.5 text-[11.5px] text-subtle">{sub}</p>}
    </Tag>
  );
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-[20px] border border-border bg-surface p-4 shadow-sm sm:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A switch with its words beside it (the plain Switch only tells screen readers). */
export function LabeledSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-[13px]">
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <span aria-hidden className={cx(disabled && "text-muted")} onClick={() => !disabled && onChange(!checked)}>
        {label}
      </span>
    </span>
  );
}

/** "12 500" → 1250000 paise. */
export const toMinor = (v: string) => Math.round((Number(String(v).replace(/[^\d.]/g, "")) || 0) * 100);
export const toMajor = (n: number) => (n ? String(n / 100) : "");

/** Whether a switchable part of the CRM ("deals", "sequences") is on. */
export function useCrmParts() {
  const { partOn } = useModules();
  return (part: string) => partOn("crm", part);
}
