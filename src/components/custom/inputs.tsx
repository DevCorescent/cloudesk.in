"use client";

// Inputs and read-only display for custom field values — shared by the
// custom-fields card on built-in records and by custom object records.
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { Input, Select, Switch, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { ENTITIES, isEntity } from "@/lib/custom/entities";
import type { FieldDef, Value, Values } from "@/lib/custom/model";

export type Def = FieldDef & { id: string };

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Where a linked record opens. */
export function linkHref(linkTo: string, id: string) {
  if (isEntity(linkTo)) return ENTITIES[linkTo].href(id);
  return `/objects/${linkTo.slice(4)}/${id}`;
}

export function display(def: Def, v: Value | undefined, titles: Record<string, string> = {}): React.ReactNode {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return <span className="text-subtle">—</span>;
  switch (def.type) {
    case "money":
      return typeof v === "number" ? inr(v) : String(v);
    case "number":
      return typeof v === "number" ? v.toLocaleString("en-IN") : String(v);
    case "checkbox":
      return v ? "Yes" : "No";
    case "multiselect":
      return Array.isArray(v) ? v.join(", ") : String(v);
    case "url":
      return <a href={String(v)} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">{String(v).replace(/^https?:\/\//, "").slice(0, 60)}</a>;
    case "email":
      return <a href={`mailto:${v}`} className="underline underline-offset-2">{String(v)}</a>;
    case "link":
      return <Link href={linkHref(def.linkTo!, String(v))} className="underline underline-offset-2">{titles[String(v)] ?? "A record that's gone"}</Link>;
    case "longtext":
      return <span className="whitespace-pre-wrap">{String(v)}</span>;
    default:
      return String(v);
  }
}

/** Plain text for exports. */
export function plain(def: Def, v: Value | undefined, titles: Record<string, string> = {}): string | number | null {
  if (v === null || v === undefined) return null;
  if (def.type === "money" && typeof v === "number") return v / 100;
  if (def.type === "checkbox") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (def.type === "link") return titles[String(v)] ?? String(v);
  return v as string | number;
}

function LinkPicker({ def, value, onChange, title, a }: { def: Def; value: string | null; onChange: (id: string | null, title?: string) => void; title?: string; a: Record<string, unknown> }) {
  const { org } = useSession();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const r = useQuery({ queryKey: ["custom", org.id, "lookup", def.linkTo, q], queryFn: () => api<{ results: { id: string; title: string; detail: string }[] }>(`/api/v1/orgs/${org.id}/custom/lookup?entity=${encodeURIComponent(def.linkTo!)}&q=${encodeURIComponent(q)}`), enabled: open });
  if (value && !open)
    return (
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate rounded-[10px] border border-border bg-surface px-3 py-2 text-[13.5px]">{title ?? "Linked"}</span>
        <button type="button" className="text-[12.5px] text-muted hover:text-fg" onClick={() => setOpen(true)}>Change</button>
        <button type="button" className="text-[12.5px] text-muted hover:text-fg" onClick={() => onChange(null)}>Clear</button>
      </div>
    );
  return (
    <div className="relative">
      <Input {...a} value={q} placeholder="Search…" onFocus={() => setOpen(true)} onChange={(e) => (setQ(e.target.value), setOpen(true))} />
      {open && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[12px] border border-border bg-surface py-1 text-[13px] shadow-lg">
          {!r.data ? <li className="px-3 py-1.5 text-muted">Searching…</li> : !r.data.results.length ? <li className="px-3 py-1.5 text-muted">Nothing found</li> : r.data.results.map((x) => (
            <li key={x.id} role="option" aria-selected={x.id === value}>
              <button type="button" className="flex w-full justify-between gap-2 px-3 py-1.5 text-left hover:bg-surface-2" onClick={() => (onChange(x.id, x.title), setOpen(false), setQ(""))}>{x.title}<span className="text-muted">{x.detail !== x.title ? x.detail : ""}</span></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** An input for one field. `value` is the stored form (money in paise). */
export function CustomInput({ def, value, onChange, titles, a }: { def: Def; value: Value | undefined; onChange: (v: Value, title?: string) => void; titles?: Record<string, string>; a: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string } }) {
  // Typed text kept as is ("12.50"), so the field doesn't reformat mid-typing.
  const [money, setMoney] = useState(typeof value === "number" ? String(value / 100) : "");
  const s = value === null || value === undefined ? "" : String(value);
  switch (def.type) {
    case "longtext":
      return <Textarea {...a} rows={3} value={s} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <Input {...a} type="number" step="any" value={s} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "money":
      return <Input {...a} type="number" step="0.01" value={money} onChange={(e) => (setMoney(e.target.value), onChange(e.target.value === "" ? null : Math.round(Number(e.target.value) * 100)))} />;
    case "date":
      return <Input {...a} type="date" value={s} onChange={(e) => onChange(e.target.value || null)} />;
    case "select":
      return (
        <Select {...a} value={s} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      );
    case "multiselect": {
      const list = Array.isArray(value) ? value : [];
      return (
        <div id={a.id} className="flex flex-wrap gap-1.5" role="group">
          {def.options.map((o) => (
            <label key={o} className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12.5px]">
              <input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case "checkbox":
      return <Switch checked={value === true} onChange={(v) => onChange(v)} label={def.label} />;
    case "url":
      return <Input {...a} type="url" value={s} placeholder="https://" onChange={(e) => onChange(e.target.value)} />;
    case "email":
      return <Input {...a} type="email" value={s} onChange={(e) => onChange(e.target.value)} />;
    case "phone":
      return <Input {...a} type="tel" value={s} onChange={(e) => onChange(e.target.value)} />;
    case "link":
      return <LinkPicker def={def} value={typeof value === "string" ? value : null} title={typeof value === "string" ? titles?.[value] : undefined} onChange={(id, t) => onChange(id, t)} a={a} />;
    default:
      return <Input {...a} value={s} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Per-field messages from a refused save (validation details, keyed by field). */
export function fieldErrors(e: unknown): { fields: Record<string, string>; rules: string[] } {
  const d = (e as { details?: unknown })?.details as Record<string, string[] | undefined> | null | undefined;
  if (!d || typeof d !== "object") return { fields: {}, rules: [] };
  const { rules, ...rest } = d;
  return { fields: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v?.[0] ?? ""])), rules: rules ?? [] };
}

export type { Values };
