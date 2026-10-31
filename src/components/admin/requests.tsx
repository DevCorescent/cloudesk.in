"use client";

// Feature requests from workspaces: read them, reply, move them through the
// pipeline, publish to the roadmap, merge duplicates — and when it's built,
// release it through a release flag to everyone or to chosen workspaces.
import { Building2, Check, ChevronRight, Flag, Globe2, Lock, Megaphone, MessageSquare, Rocket, Search, ThumbsUp, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { PRIORITY_LABEL, REQUEST_STATUSES, SCOPE_LABEL, STATUS_INFO, type AdminRequestOut, type NoteOut, type RequestStatus } from "@/lib/requests/model";
import { MODULES } from "@/lib/workspace/modules";
import { useAdmin, useCan, useRun } from "./common";

type List = { requests: AdminRequestOut[]; counts: Record<string, number> };
type Detail = { request: AdminRequestOut; notes: NoteOut[]; voterWorkspaces: number; suggestedKey: string };

const TONE: Record<string, "neutral" | "accent" | "warning" | "success" | "danger"> = { neutral: "neutral", info: "accent", warning: "warning", success: "success", danger: "danger" };
const areaName = (a: string) => (a === "new" ? "Something new" : (MODULES.find((m) => m.id === a)?.name ?? a));
const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function StatusPill({ s }: { s: RequestStatus }) {
  return <Badge tone={TONE[STATUS_INFO[s].tone] ?? "neutral"}>{STATUS_INFO[s].label}</Badge>;
}

export function RequestsPanel() {
  const [status, setStatus] = useState("open");
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState("new");
  const [q, setQ] = useState("");
  const [deb, setDeb] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDeb(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const [open, setOpen] = useState<string | null>(() => (typeof location !== "undefined" ? (/^#requests\/([0-9a-f-]{36})$/.exec(location.hash)?.[1] ?? null) : null));
  const list = useAdmin<List>(`requests?status=${status}&scope=${scope}&sort=${sort}&q=${encodeURIComponent(deb)}`);
  if (list.isError) return <ErrorState message={errorMessage(list.error)} />;
  const c = list.data?.counts ?? {};
  const openCount = ["submitted", "under_review", "planned", "in_progress", "testing"].reduce((a, k) => a + (c[k] ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
        <button type="button" onClick={() => setStatus("open")} className={cx("rounded-[14px] border p-3 text-left", status === "open" ? "border-fg bg-surface-2" : "border-border hover:bg-surface-2")}>
          <p className="text-[11.5px] text-muted">Open</p><p className="text-[20px] font-semibold tabular-nums">{openCount}</p>
        </button>
        {REQUEST_STATUSES.map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={cx("rounded-[14px] border p-3 text-left", status === s ? "border-fg bg-surface-2" : "border-border hover:bg-surface-2")}>
            <p className="truncate text-[11.5px] text-muted">{STATUS_INFO[s].label}</p><p className={cx("text-[20px] font-semibold tabular-nums", s === "submitted" && (c[s] ?? 0) > 0 && "text-danger")}>{c[s] ?? 0}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, problem or #number" className="pl-8" aria-label="Search requests" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="!w-40"><option value="open">Open</option><option value="all">All</option>{REQUEST_STATUSES.map((s) => <option key={s} value={s}>{STATUS_INFO[s].label}</option>)}</Select>
        <Select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Filter by who it's for" className="!w-44"><option value="all">For anyone</option><option value="workspace">For one workspace</option><option value="everyone">For everyone</option></Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className="!w-36"><option value="new">Newest</option><option value="votes">Most votes</option><option value="priority">Most urgent</option></Select>
      </div>
      {!list.data ? <Skeleton className="h-60" /> : !list.data.requests.length ? (
        <Card className="p-10 text-center"><p className="text-[14px] font-medium">No requests here</p><p className="text-[12.5px] text-muted">Workspaces ask from “Request a feature” in their sidebar.</p></Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {list.data.requests.map((r) => (
            <button key={r.id} type="button" onClick={() => { setOpen(r.id); history.replaceState(null, "", `#requests/${r.id}`); }} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
              <span className="w-12 shrink-0 text-[12px] font-semibold text-subtle tabular-nums">#{r.number}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5"><span className="truncate text-[14px] font-medium">{r.title}</span>{r.priority === "critical" && <Badge tone="danger">Blocking</Badge>}{r.scope === "workspace" ? <span className="inline-flex items-center gap-1 text-[11.5px] text-muted"><Lock className="size-3" />Their workspace</span> : <span className="inline-flex items-center gap-1 text-[11.5px] text-muted"><Globe2 className="size-3" />Everyone</span>}{r.public && <Badge tone="accent">On roadmap</Badge>}</span>
                <span className="block truncate text-[12px] text-muted">{r.org.name} · {r.requester?.name ?? "Someone"} · {areaName(r.area)} · {when(r.createdAt)}{r.noteCount ? ` · ${r.noteCount} comment${r.noteCount === 1 ? "" : "s"}` : ""}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-muted tabular-nums"><ThumbsUp className="size-3.5" />{r.votes}</span>
              <StatusPill s={r.status} />
              <ChevronRight className="size-4 shrink-0 text-subtle" />
            </button>
          ))}
        </Card>
      )}
      {open && <RequestDialog id={open} onClose={() => { setOpen(null); history.replaceState(null, "", "#requests"); }} />}
    </div>
  );
}

function RequestDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useAdmin<Detail>(`requests/${id}`);
  const run = useRun();
  const can = useCan();
  const write = can("requests:write");
  const flags = can("flags:write");
  const r = q.data?.request;
  const [v, setV] = useState<{ status: RequestStatus; reply: string; eta: string; public: boolean; title: string } | null>(null);
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState(true);
  const [dupOf, setDupOf] = useState("");
  const form = v ?? (r ? { status: r.status, reply: r.reply, eta: r.eta ?? "", public: r.public, title: r.title } : null);
  if (q.isError) return <Dialog open onClose={onClose} title="Request"><ErrorState message={errorMessage(q.error)} /></Dialog>;
  return (
    <Dialog open onClose={onClose} size="2xl" title={r ? `#${r.number} · ${r.title}` : "Request"} description={r ? `${r.org.name} · ${r.requester?.name ?? "Someone"} (${r.requester?.email ?? "—"}) · ${when(r.createdAt)}` : undefined}>
      {!r || !form ? <Skeleton className="h-80" /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 content-start gap-4">
            <div className="flex flex-wrap gap-1.5">
              <StatusPill s={r.status} />
              <Badge tone={r.priority === "critical" ? "danger" : r.priority === "important" ? "warning" : "neutral"}>{PRIORITY_LABEL[r.priority]}</Badge>
              <Badge>{SCOPE_LABEL[r.scope].label}</Badge>
              <Badge>{areaName(r.area)}</Badge>
              <Badge><ThumbsUp className="mr-1 inline size-3" />{r.votes} vote{r.votes === 1 ? "" : "s"} · {q.data!.voterWorkspaces} workspace{q.data!.voterWorkspaces === 1 ? "" : "s"}</Badge>
            </div>
            <section className="rounded-[16px] border border-border p-4">
              <p className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">What they&apos;re trying to do</p>
              <p className="mt-1 text-[14px] whitespace-pre-wrap">{r.problem}</p>
              {r.details && <><p className="mt-3 text-[11.5px] font-semibold tracking-wide text-muted uppercase">Details</p><p className="mt-1 text-[13.5px] whitespace-pre-wrap text-fg/85">{r.details}</p></>}
            </section>
            <section>
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><MessageSquare className="size-4" />Conversation</p>
              <Timeline notes={q.data!.notes} team />
              {write && (
                <div className="mt-3 grid gap-2">
                  <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={internal ? "Internal note — only the Cloudesk team sees it" : `Message to ${r.org.name} — they're notified`} aria-label="Note" className={cx(internal && "bg-amber-500/5")} />
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-[12.5px]"><Switch label="Internal" checked={internal} onChange={setInternal} /> Internal note</label>
                    <Button size="sm" variant="primary" disabled={!note.trim()} onClick={async () => { if (await run(`requests/${id}/notes`, "POST", { body: note, internal }, internal ? "Note added" : "Sent to the workspace")) setNote(""); }}>{internal ? "Add note" : "Send"}</Button>
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="grid content-start gap-4">
            <Card className="grid gap-3 p-4">
              <p className="text-[13px] font-semibold">Status &amp; reply</p>
              <Field label="Title (as workspaces see it)">{(a) => <Input {...a} value={form.title} disabled={!write} onChange={(e) => setV({ ...form, title: e.target.value })} maxLength={140} />}</Field>
              <Field label="Status">{(a) => <Select {...a} value={form.status} disabled={!write} onChange={(e) => setV({ ...form, status: e.target.value as RequestStatus })}>{REQUEST_STATUSES.filter((s) => s !== "released" || r.status === "released").map((s) => <option key={s} value={s}>{STATUS_INFO[s].label}</option>)}</Select>}</Field>
              {form.status === "duplicate" && r.status !== "duplicate" && <Field label="Duplicate of (request id)" hint="Votes move over to it">{(a) => <Input {...a} value={dupOf} onChange={(e) => setDupOf(e.target.value.trim())} placeholder="Paste the other request's id" />}</Field>}
              <Field label="Expected by (optional)">{(a) => <Input {...a} type="date" value={form.eta} disabled={!write} onChange={(e) => setV({ ...form, eta: e.target.value })} />}</Field>
              <Field label="Reply to the workspace" hint="Shown on the request (and on the roadmap if public)">{(a) => <Textarea {...a} rows={3} value={form.reply} disabled={!write} onChange={(e) => setV({ ...form, reply: e.target.value })} maxLength={4000} />}</Field>
              <label className="flex items-start gap-2 text-[12.5px]"><Switch label="Public" checked={form.public} onChange={(p) => setV({ ...form, public: p })} /><span><b className="font-medium">On the public roadmap</b><span className="block text-muted">Other workspaces see the title, your reply and status (never their words), and can vote.</span></span></label>
              {write && <Button variant="primary" onClick={async () => { if (await run(`requests/${id}`, "PUT", { title: form.title, status: form.status === r.status ? undefined : form.status, reply: form.reply, eta: form.eta || null, public: form.public, ...(form.status === "duplicate" && dupOf ? { duplicateOf: dupOf } : {}) }, "Saved — the workspace is told about changes")) setV(null); }}>Save</Button>}
            </Card>
            <ReleaseCard d={q.data!} can={flags} onRun={run} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ReleaseCard({ d, can, onRun }: { d: Detail; can: boolean; onRun: ReturnType<typeof useRun> }) {
  const r = d.request;
  const [key, setKey] = useState(d.suggestedKey);
  const [mode, setMode] = useState<"everyone" | "workspaces">(r.scope === "everyone" ? "everyone" : "workspaces");
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([{ id: r.org.id, name: r.org.name }]);
  const [notes, setNotes] = useState("");
  const [announce, setAnnounce] = useState(true);
  const [q, setQ] = useState("");
  const found = useAdmin<{ workspaces: { id: string; name: string; slug: string }[] }>(`requests/workspaces?q=${encodeURIComponent(q)}`, { enabled: mode === "workspaces" && q.length > 1 });
  const flagState = r.flag ? (r.flag.enabled ? "On for everyone" : `On for ${r.flag.orgIds.length} workspace${r.flag.orgIds.length === 1 ? "" : "s"}`) : null;
  const closed = r.status === "declined" || r.status === "duplicate";
  const picked = useMemo(() => new Set(orgs.map((o) => o.id)), [orgs]);
  return (
    <Card className="grid gap-3 p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold"><Rocket className="size-4" />Release</p>
      {r.flagKey && flagState && (
        <div className="rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px]">
          <p className="flex items-center gap-1.5"><Flag className="size-3.5" /><code>{r.flagKey}</code></p>
          <p className="mt-0.5 text-muted">{flagState}{r.release ? ` · released ${when(r.release.at)}` : ""}</p>
        </div>
      )}
      {!can ? <p className="text-[12.5px] text-muted">Releasing needs the “flags” permission (owner or admin).</p> : closed ? <p className="text-[12.5px] text-muted">Reopen it to release.</p> : (
        <>
          <Field label="Release flag" hint="Your code checks this flag (isFlagOn / useFlag). Re-using an existing key extends it.">{(a) => <Input {...a} value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} className="font-mono text-[12.5px]" />}</Field>
          <div className="grid gap-1.5">
            <p className="text-[13px] font-medium">Give it to</p>
            {(["everyone", "workspaces"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={cx("flex items-start gap-2.5 rounded-[12px] border p-2.5 text-left", mode === m ? "border-fg bg-surface-2" : "border-border hover:bg-surface-2")}>
                {m === "everyone" ? <Globe2 className="mt-0.5 size-4 shrink-0" /> : <Building2 className="mt-0.5 size-4 shrink-0" />}
                <span><span className="block text-[13px] font-medium">{m === "everyone" ? "Every workspace" : "Chosen workspaces"}</span><span className="block text-[11.5px] text-muted">{m === "everyone" ? "On for all, now and for new sign-ups; shown in everyone's What's new" : "Only these — added to any that already have it"}</span></span>
              </button>
            ))}
          </div>
          {mode === "workspaces" && (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-1.5">{orgs.map((o) => <span key={o.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-2.5 text-[12px]">{o.name}<button type="button" aria-label={`Remove ${o.name}`} onClick={() => setOrgs(orgs.filter((x) => x.id !== o.id))} className="grid size-4 place-items-center rounded-full hover:bg-fg/10"><X className="size-3" /></button></span>)}</div>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a workspace by name" aria-label="Find a workspace" />
              {q.length > 1 && (
                <ul className="max-h-40 overflow-y-auto rounded-[10px] border border-border">
                  {(found.data?.workspaces ?? []).map((w) => (
                    <li key={w.id}><button type="button" onClick={() => { if (!picked.has(w.id)) setOrgs([...orgs, { id: w.id, name: w.name }]); setQ(""); }} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-2">{w.name}<span className="text-subtle">{picked.has(w.id) ? <Check className="size-3.5" /> : w.slug}</span></button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Field label="Release notes (what's new, where to find it)">{(a) => <Textarea {...a} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Invoicing → Export → All invoices as PDF (zip)" maxLength={4000} />}</Field>
          <label className="flex items-start gap-2 text-[12.5px]"><Switch label="Announce" checked={announce} onChange={setAnnounce} /><span><b className="font-medium">Tell everyone in {mode === "everyone" ? "the asking workspace" : "those workspaces"}</b><span className="block text-muted">{mode === "everyone" ? "Everyone else sees it in What's new." : "The people who asked are always told."}</span></span></label>
          <Button variant="primary" icon={<Megaphone className="size-3.5" />} disabled={!key || (mode === "workspaces" && !orgs.length)} onClick={() => void onRun(`requests/${r.id}/release`, "POST", { flagKey: key, mode, orgIds: orgs.map((o) => o.id), notes, announce }, mode === "everyone" ? "Released to everyone" : `Released to ${orgs.length} workspace${orgs.length === 1 ? "" : "s"}`)}>
            {r.status === "released" ? "Release further" : "Release"}
          </Button>
          {r.flag && (r.flag.enabled || r.flag.orgIds.length > 0) && <Button variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => void onRun(`requests/${r.id}/rollback`, "POST", { all: true }, "Rolled back — the flag is off and the request is back in Testing")}>Roll back everywhere</Button>}
        </>
      )}
    </Card>
  );
}

export function Timeline({ notes, team }: { notes: NoteOut[]; team?: boolean }) {
  if (!notes.length) return <p className="rounded-[14px] border border-dashed border-border px-4 py-5 text-center text-[12.5px] text-muted">Nothing yet.</p>;
  return (
    <ol className="grid gap-2">
      {notes.map((n) => (
        <li key={n.id} className={cx("rounded-[14px] border px-3.5 py-2.5 text-[13px]", n.internal ? "border-amber-500/30 bg-amber-500/5" : n.fromTeam ? "border-sky-500/25 bg-sky-500/5" : "border-border")}>
          <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
            <b className="font-semibold text-fg">{n.fromTeam ? (team ? `${n.by ?? "Team"} (Cloudesk)` : "Cloudesk team") : (n.by ?? "Someone")}</b>
            {n.kind === "status" && <span>moved it to <b className="font-medium text-fg">{STATUS_INFO[(n.meta.to as RequestStatus) ?? "submitted"]?.label}</b></span>}
            {n.kind === "release" && <span className="font-medium text-emerald-700 dark:text-emerald-400">released it{n.meta.mode === "everyone" ? " to everyone" : ` to ${n.meta.workspaces} workspace${n.meta.workspaces === 1 ? "" : "s"}`}</span>}
            {n.internal && <Badge tone="warning">Internal</Badge>}
            <span className="ml-auto">{new Date(n.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
          </p>
          {n.body && <p className="mt-1 whitespace-pre-wrap">{n.body}</p>}
        </li>
      ))}
    </ol>
  );
}
