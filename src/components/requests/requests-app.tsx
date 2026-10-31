"use client";

// Request a feature: ask the Cloudesk team for something your workspace
// needs, follow it from submitted to released, talk with the team, vote on
// the public roadmap, and see what's been released to you.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Check, Globe2, Lightbulb, Map as MapIcon, MessageSquare, Plus, Rocket, Sparkles, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Timeline } from "@/components/admin/requests";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { PIPELINE, PRIORITIES, PRIORITY_LABEL, SCOPE_LABEL, SCOPES, STATUS_INFO, type NoteOut, type RequestOut, type RequestStatus } from "@/lib/requests/model";
import { MODULES, visibleTo } from "@/lib/workspace/modules";

const TONE: Record<string, "neutral" | "accent" | "warning" | "success" | "danger"> = { neutral: "neutral", info: "accent", warning: "warning", success: "success", danger: "danger" };
const areaName = (a: string) => (a === "new" ? "Something new" : (MODULES.find((m) => m.id === a)?.name ?? a));
const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function useReqApi() {
  const { org } = useSession();
  const base = `/api/v1/orgs/${org.id}/requests`;
  return { org, call: <T,>(p: string, method = "GET", body?: unknown) => api<T>(`${base}${p ? `/${p}` : ""}`, method === "GET" || method === "DELETE" ? { method } : { method, body: body ?? {} }), key: (...k: unknown[]) => ["requests", org.id, ...k] };
}

export function RequestsApp() {
  const path = usePathname().replace(/^\/requests\/?/, "");
  const id = /^[0-9a-f-]{36}$/i.test(path) ? path : null;
  return id ? <RequestPage id={id} /> : <RequestsHome initialTab={path === "roadmap" ? "roadmap" : path === "new" ? "new" : "ours"} />;
}

function StatusPill({ s }: { s: RequestStatus }) {
  return <Badge tone={TONE[STATUS_INFO[s].tone] ?? "neutral"}>{STATUS_INFO[s].label}</Badge>;
}

/** Submitted → … → Released, with where it is now. */
function Progress({ s }: { s: RequestStatus }) {
  if (s === "declined" || s === "duplicate") return null;
  const at = PIPELINE.indexOf(s);
  return (
    <ol className="flex items-center gap-1" aria-label={`Progress: ${STATUS_INFO[s].label}`}>
      {PIPELINE.map((p, i) => (
        <li key={p} className="flex flex-1 items-center gap-1" title={STATUS_INFO[p].label}>
          <span className={cx("h-1.5 flex-1 rounded-full", i <= at ? (s === "released" ? "bg-emerald-500" : "bg-[var(--accent)]") : "bg-surface-3")} />
        </li>
      ))}
    </ol>
  );
}

function VoteButton({ r, onChange }: { r: RequestOut; onChange: (r: RequestOut) => void }) {
  const { call } = useReqApi();
  const toast = useToast();
  return (
    <button
      type="button"
      aria-pressed={r.voted}
      title={r.voted ? "You want this — click to take your vote back" : "Want this too? Vote for it"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void call<{ votes: number; voted: boolean }>(`${r.id}/vote`, r.voted ? "DELETE" : "POST").then((x) => onChange({ ...r, ...x })).catch((err) => toast({ tone: "error", title: errorMessage(err) }));
      }}
      className={cx("grid w-14 shrink-0 place-items-center rounded-[12px] border py-1.5 text-center transition-colors", r.voted ? "border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--accent)]" : "border-border hover:bg-surface-2")}
    >
      <ThumbsUp className={cx("size-4", r.voted && "fill-current")} />
      <span className="text-[13px] font-semibold tabular-nums">{r.votes}</span>
    </button>
  );
}

function RequestRow({ r, onChange }: { r: RequestOut; onChange: (r: RequestOut) => void }) {
  return (
    <Link href={`/requests/${r.id}`} className="flex items-start gap-3 px-4 py-3.5 hover:bg-surface-2">
      <VoteButton r={r} onChange={onChange} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[14.5px] font-semibold">{r.title}</span>
          <StatusPill s={r.status} />
          {r.ours && r.scope === "workspace" && <span className="inline-flex items-center gap-1 text-[11.5px] text-muted"><Building2 className="size-3" />For us</span>}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-muted">{r.ours && r.problem ? r.problem : r.reply || STATUS_INFO[r.status].what}</span>
        <span className="mt-2 block max-w-md"><Progress s={r.status} /></span>
        <span className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-subtle">
          <span>#{r.number}</span>
          <span>{areaName(r.area)}</span>
          {r.by && <span>by {r.by}</span>}
          <span>{when(r.createdAt)}</span>
          {r.eta && r.status !== "released" && <span className="font-medium text-[var(--accent)]">Expected {when(r.eta)}</span>}
          {r.noteCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3" />{r.noteCount}</span>}
        </span>
      </span>
    </Link>
  );
}

function RequestsHome({ initialTab }: { initialTab: "ours" | "roadmap" | "new" }) {
  const { call, key } = useReqApi();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"ours" | "roadmap" | "new">(initialTab);
  const [asking, setAsking] = useState(false);
  const ours = useQuery({ queryKey: key("ours"), queryFn: () => call<{ requests: RequestOut[] }>("") });
  const map = useQuery({ queryKey: key("roadmap"), queryFn: () => call<{ requests: RequestOut[] }>("?view=roadmap"), enabled: tab === "roadmap" });
  const news = useQuery({ queryKey: key("new"), queryFn: () => call<{ releases: RequestOut[] }>("whats-new"), enabled: tab === "new" });
  const patch = (r: RequestOut) => {
    for (const k of ["ours", "roadmap"]) qc.setQueryData<{ requests: RequestOut[] }>(key(k), (d) => (d ? { requests: d.requests.map((x) => (x.id === r.id ? r : x)) } : d));
  };
  const open = (ours.data?.requests ?? []).filter((r) => STATUS_INFO[r.status].open).length;
  const tabs = [
    { id: "ours" as const, label: `Our requests${ours.data ? ` (${ours.data.requests.length})` : ""}`, icon: <Lightbulb className="size-3.5" /> },
    { id: "roadmap" as const, label: "Roadmap", icon: <MapIcon className="size-3.5" /> },
    { id: "new" as const, label: "What's new", icon: <Sparkles className="size-3.5" /> },
  ];
  const data = tab === "ours" ? ours : tab === "roadmap" ? map : null;
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <PageHeader title="Request a feature" description="Tell the Cloudesk team what would make Cloudesk work better for you — for your workspace, or for everyone. Follow it here from idea to release." actions={<Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAsking(true)}>Request a feature</Button>} />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-[12px] text-muted">Open requests</p><p className="text-[22px] font-semibold tabular-nums">{ours.data ? open : "–"}</p></Card>
        <Card className="p-4"><p className="text-[12px] text-muted">Released to you</p><p className="text-[22px] font-semibold tabular-nums">{ours.data ? ours.data.requests.filter((r) => r.status === "released").length : "–"}</p></Card>
        <Card className="flex items-center gap-3 p-4"><Rocket className="size-8 shrink-0 text-[var(--accent)]" /><p className="text-[12.5px] text-muted">Built just for you? The team can switch it on for your workspace only.</p></Card>
      </div>
      <div className="mt-5 flex gap-1 border-b border-border" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cx("relative flex h-10 items-center gap-1.5 px-3 text-[13px]", tab === t.id ? "font-semibold" : "text-muted hover:text-fg")}>
            {t.icon}{t.label}{tab === t.id && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-fg" />}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === "new" ? (
          news.isError ? <ErrorState message={errorMessage(news.error)} /> : !news.data ? <Skeleton className="h-40" /> : !news.data.releases.length ? (
            <EmptyState icon={<Sparkles />} title="Nothing released yet" description="When a requested feature goes live for your workspace (or for everyone), it shows here with how to use it." />
          ) : (
            <ol className="grid gap-3">
              {news.data.releases.map((r) => (
                <li key={r.id}>
                  <Card className="p-4">
                    <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted"><Badge tone="success">Released</Badge>{when(r.released!.at)}{r.ours && <span className="inline-flex items-center gap-1 font-medium text-fg"><Check className="size-3.5" />You asked for this</span>}</p>
                    <Link href={`/requests/${r.id}`} className="mt-1.5 block text-[15px] font-semibold hover:underline">{r.title}</Link>
                    {r.released!.notes && <p className="mt-1 text-[13.5px] whitespace-pre-wrap text-fg/85">{r.released!.notes}</p>}
                  </Card>
                </li>
              ))}
            </ol>
          )
        ) : data?.isError ? <ErrorState message={errorMessage(data.error)} /> : !data?.data ? <Skeleton className="h-60" /> : !data.data.requests.length ? (
          tab === "ours" ? <EmptyState icon={<Lightbulb />} title="No requests yet" description="Missing something? A report, a field, a whole new module — ask, and follow it here." action={<Button variant="primary" onClick={() => setAsking(true)}>Request a feature</Button>} /> : <EmptyState icon={<MapIcon />} title="The roadmap is empty for now" description="Requests the Cloudesk team makes public show here for everyone to vote on." />
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {data.data.requests.map((r) => <RequestRow key={r.id} r={r} onChange={patch} />)}
          </Card>
        )}
        {tab === "roadmap" && <p className="mt-3 text-[12px] text-muted">The roadmap shows what the team has made public — titles and the team&apos;s notes only, never another workspace&apos;s own words.</p>}
      </div>
      {asking && <AskDialog onClose={() => setAsking(false)} />}
    </div>
  );
}

function AskDialog({ onClose }: { onClose: () => void }) {
  const { call, key, org } = useReqApi();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({ title: "", problem: "", details: "", area: "new", priority: "important" as (typeof PRIORITIES)[number], scope: "everyone" as (typeof SCOPES)[number] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string[]>>({});
  // Maybe it's already asked: similar titles on the roadmap and in your workspace.
  const [deb, setDeb] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDeb(v.title.trim()), 350);
    return () => clearTimeout(t);
  }, [v.title]);
  const similar = useQuery({ queryKey: key("similar", deb), queryFn: () => call<{ requests: RequestOut[] }>(`?view=roadmap&q=${encodeURIComponent(deb.split(/\s+/).slice(0, 3).join(" "))}`), enabled: deb.length >= 5 });
  const go = async () => {
    setBusy(true);
    setErr({});
    try {
      const r = await call<{ request: RequestOut }>("", "POST", v);
      void qc.invalidateQueries({ queryKey: ["requests", org.id] });
      toast({ tone: "success", title: `Request #${r.request.number} sent`, description: "The Cloudesk team has it. You'll be told as it moves." });
      router.push(`/requests/${r.request.id}`);
      onClose();
    } catch (e) {
      setErr((e as { details?: Record<string, string[]> }).details ?? {});
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const modules = MODULES.filter((m) => visibleTo(org, m.id));
  return (
    <Dialog open onClose={onClose} size="lg" title="Request a feature" description="The clearer the problem, the better the result — say what you're trying to get done, not just the button you want." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={v.title.trim().length < 6 || v.problem.trim().length < 10} onClick={() => void go()}>Send to Cloudesk</Button></>}>
      <div className="grid gap-4">
        <Field label="In a few words" error={err.title?.[0]}>{(p) => <Input {...p} autoFocus value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. Export all invoices of a year as PDFs" maxLength={140} />}</Field>
        {(similar.data?.requests.length ?? 0) > 0 && (
          <div className="rounded-[14px] border border-sky-500/25 bg-sky-500/5 p-3">
            <p className="text-[12.5px] font-medium">Already asked? Vote for it instead — it moves faster with more votes.</p>
            <ul className="mt-1.5 grid gap-1">{similar.data!.requests.slice(0, 4).map((r) => <li key={r.id}><Link href={`/requests/${r.id}`} onClick={onClose} className="flex items-center justify-between gap-2 rounded-[9px] px-2 py-1 text-[13px] hover:bg-surface-2"><span className="truncate">{r.title}</span><span className="flex shrink-0 items-center gap-2"><StatusPill s={r.status} /><span className="flex items-center gap-1 text-muted"><ThumbsUp className="size-3" />{r.votes}</span></span></Link></li>)}</ul>
          </div>
        )}
        <Field label="What are you trying to do?" hint="What's hard or slow today, and what would make it easy" error={err.problem?.[0]}>{(p) => <Textarea {...p} rows={4} value={v.problem} onChange={(e) => setV({ ...v, problem: e.target.value })} placeholder="e.g. Our auditor asks for every invoice of the year as PDFs. Today we open and print each one — 400+ invoices." maxLength={4000} />}</Field>
        <Field label="Anything else (optional)" hint="Steps, examples, who uses it, how often">{(p) => <Textarea {...p} rows={3} value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} maxLength={8000} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Where in Cloudesk">{(p) => <Select {...p} value={v.area} onChange={(e) => setV({ ...v, area: e.target.value })}><option value="new">Something new</option>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
          <Field label="How much does it matter?">{(p) => <Select {...p} value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value as typeof v.priority })}>{PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}</Select>}</Field>
        </div>
        <div className="grid gap-1.5">
          <p className="text-[13px] font-medium">Who is it for?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCOPES.map((s) => (
              <button key={s} type="button" onClick={() => setV({ ...v, scope: s })} className={cx("flex items-start gap-2.5 rounded-[14px] border p-3 text-left", v.scope === s ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-border hover:bg-surface-2")}>
                {s === "workspace" ? <Building2 className="mt-0.5 size-4 shrink-0" /> : <Globe2 className="mt-0.5 size-4 shrink-0" />}
                <span><span className="block text-[13.5px] font-semibold">{SCOPE_LABEL[s].label}</span><span className="block text-[12px] text-muted">{SCOPE_LABEL[s].what}</span></span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function RequestPage({ id }: { id: string }) {
  const { call, key, org } = useReqApi();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const q = useQuery({ queryKey: key("one", id), queryFn: () => call<{ request: RequestOut; notes: NoteOut[] }>(id) });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  if (q.isError) return <div className="mx-auto max-w-3xl p-6"><ErrorState message={errorMessage(q.error)} /></div>;
  if (!q.data) return <div className="mx-auto max-w-3xl p-6"><Skeleton className="h-80" /></div>;
  const { request: r, notes } = q.data;
  const set = (x: RequestOut) => qc.setQueryData(key("one", id), { request: x, notes });
  const send = async () => {
    setBusy(true);
    try {
      const out = await call<{ notes: NoteOut[] }>(`${id}/comments`, "POST", { body: text });
      qc.setQueryData(key("one", id), { request: r, notes: out.notes });
      setText("");
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link href="/requests" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Feature requests</Link>
      <div className="flex items-start gap-4">
        <VoteButton r={r} onChange={set} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted"><span>#{r.number}</span><StatusPill s={r.status} /><span>{areaName(r.area)}</span>{r.ours && <span>{SCOPE_LABEL[r.scope].label}</span>}{r.ours && <span>{PRIORITY_LABEL[r.priority]}</span>}</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">{r.title}</h1>
          <p className="text-[12.5px] text-muted">{r.by ? `Asked by ${r.by} · ` : ""}{when(r.createdAt)}</p>
        </div>
      </div>
      <Card className="mt-5 p-4">
        <div className="mb-2 flex items-center justify-between text-[12px]"><span className="font-semibold">{STATUS_INFO[r.status].label}</span>{r.eta && r.status !== "released" && <span className="text-muted">Expected by <b className="font-medium text-fg">{when(r.eta)}</b></span>}</div>
        <Progress s={r.status} />
        <div className="mt-1.5 hidden justify-between text-[10.5px] text-subtle sm:flex">{PIPELINE.map((p) => <span key={p}>{STATUS_INFO[p].label}</span>)}</div>
        <p className="mt-3 text-[13px] text-muted">{STATUS_INFO[r.status].what}.</p>
        {r.duplicateOf && <p className="mt-2 text-[13px]">Followed in <Link href={`/requests/${r.duplicateOf.id}`} className="font-medium text-[var(--accent)] hover:underline">#{r.duplicateOf.number} {r.duplicateOf.title}</Link> — your vote moved there.</p>}
        {r.released && <div className="mt-3 rounded-[12px] bg-emerald-500/8 px-3 py-2.5 text-[13px]"><p className="font-semibold text-emerald-700 dark:text-emerald-400">{r.released.forUs ? "Live in your workspace" : "Released"} · {when(r.released.at)}</p>{r.released.notes && <p className="mt-0.5 whitespace-pre-wrap">{r.released.notes}</p>}</div>}
      </Card>
      {r.reply && <Card className="mt-3 border-sky-500/25 bg-sky-500/5 p-4"><p className="text-[11.5px] font-semibold tracking-wide text-sky-700 uppercase dark:text-sky-400">From the Cloudesk team</p><p className="mt-1 text-[14px] whitespace-pre-wrap">{r.reply}</p></Card>}
      {r.ours && (
        <>
          <section className="mt-5">
            <h2 className="text-[13px] font-semibold">What you asked</h2>
            <p className="mt-1 text-[14px] whitespace-pre-wrap">{r.problem}</p>
            {r.details && <p className="mt-2 text-[13.5px] whitespace-pre-wrap text-fg/80">{r.details}</p>}
            {r.mine && r.status === "submitted" && <div className="mt-2"><Button size="sm" variant="ghost" onClick={() => setWithdraw(true)}>Withdraw</Button></div>}
          </section>
          <section className="mt-6">
            <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><MessageSquare className="size-4" />Conversation with the Cloudesk team</h2>
            <Timeline notes={notes} />
            <div className="mt-3 grid gap-2">
              <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add details, answer the team's questions, or say how it's going" aria-label="Comment" maxLength={4000} />
              <div className="flex justify-end"><Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void send()}>Send</Button></div>
            </div>
          </section>
        </>
      )}
      {withdraw && <ConfirmDialog open title="Withdraw this request?" description="It's removed, with its votes. You can always ask again." confirmLabel="Withdraw" destructive onClose={() => setWithdraw(false)} onConfirm={() => void call(id, "DELETE").then(() => { void qc.invalidateQueries({ queryKey: ["requests", org.id] }); router.push("/requests"); })} />}
    </div>
  );
}
