"use client";

// AI copilot: ask a question, see the answer with the lookups it made, and
// confirm or dismiss the changes it suggests. Conversations are private to
// the person who had them.
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Check, History, MessageSquarePlus, Search, Send, ShieldAlert, Sparkles, Table2, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { ConfirmDialog } from "@/components/ui/overlays";
import { Badge, Button, ButtonLink, Notice, PageHeader, Skeleton, Spinner, Textarea, cx } from "@/components/ui/primitives";
import { parseMarkdown, type Inline } from "@/lib/copilot/markdown";
import type { ViewItem } from "@/lib/copilot/model";
import { AnswerChart } from "./answer-chart";
import { DocFlow } from "@/components/documents/studio-flow";

type Meta = { connected: boolean; canConnect: boolean; books: boolean };
type Finding = { kind: string; title: string; detail: string; link: string; amount: number };
type Action = { id: string; kind: string; label: string; summary: string; status: "proposed" | "running" | "done" | "dismissed" | "failed"; error: string; result: { link?: string } | null; toolUseId: string };
type Thread = { id: string; title: string; items: ViewItem[]; actions: Action[] };

const useCopilot = () => useModule<Meta>();
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function CopilotApp({ path }: { path: string[] }) {
  const [section = ""] = path;
  return (
    <ModuleFrame<Meta>
      api="copilot"
      base="copilot"
      title="Copilot"
      icon={<Sparkles />}
      section={isId(section) ? "history" : section}
      nav={(m) => [
        { id: "", label: "Ask", icon: <MessageSquarePlus /> },
        { id: "history", label: "Conversations", icon: <History /> },
        { id: "checks", label: "Checks", icon: <ShieldAlert />, hidden: !m.books },
        { id: "activity", label: "AI activity", icon: <Activity />, hidden: !m.canConnect },
      ]}
      render={() => (isId(section) ? <ThreadView key={section} id={section} /> : section === "history" ? <HistoryView /> : section === "checks" ? <ChecksView /> : section === "activity" ? <ActivityView /> : <ThreadView key="new" id={null} />)}
    />
  );
}

function NotConnected() {
  const { meta } = useCopilot();
  if (meta.connected) return null;
  return (
    <Notice tone="warning" title="No AI provider is connected" action={meta.canConnect ? <ButtonLink href="/settings/ai" size="sm">Connect a provider</ButtonLink> : undefined}>
      The copilot uses Claude through your workspace&apos;s Anthropic API key. {meta.canConnect ? "Add one under Settings → AI providers." : "Ask a workspace owner or admin to add one."}
    </Notice>
  );
}

const EXAMPLES = ["Which customers owe us the most right now?", "How do this month's sales compare with last month?", "Which open deals haven't moved in a while?", "What's running low in stock?"];

function ThreadView({ id }: { id: string | null }) {
  const { meta, go, orgId } = useCopilot();
  const qc = useQueryClient();
  const t = useModuleQuery<Thread>(id ? `threads/${id}` : null);
  // A question typed on Home (/copilot?q=…) waits in the box, ready to send.
  const asked0 = useSearchParams().get("q");
  const [text, setText] = useState(() => (!id && asked0 ? asked0.slice(0, 4000) : ""));
  const [asked, setAsked] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const send = useModuleAction<string, Thread>((q) => ({ path: id ? `threads/${id}/messages` : "threads", body: { text: q } }), {
    onDone: (r) => {
      setAsked(null);
      qc.setQueryData(["copilot", orgId, `threads/${r.id}`], r);
      if (!id) go(r.id);
    },
  });
  const remove = useModuleAction(() => ({ path: `threads/${id}`, method: "DELETE" }), { success: "Conversation deleted", onDone: () => go("history") });
  const items = t.data?.items ?? [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items.length, asked]);

  const submit = () => {
    const q = text.trim();
    if (!q || send.isPending) return;
    setAsked(q);
    setText("");
    send.mutate(q, { onError: () => (setAsked(null), setText(q)) });
  };

  if (id && t.isLoading) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const actions = t.data?.actions ?? [];
  return (
    <div className="flex min-h-[70vh] flex-col gap-4">
      <PageHeader
        title={t.data?.title ?? "Ask the copilot"}
        description={id ? undefined : "Answers come from your workspace's data, limited to what your role can see. Anything it suggests changing waits for you to confirm."}
        actions={id ? <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => setDel(true)}>Delete</Button> : undefined}
      />
      <NotConnected />
      <div className="flex-1 space-y-3" aria-live="polite">
        {!id && !asked && (
          <div className="grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" disabled={!meta.connected} onClick={() => setText(e)} className="rounded-[16px] border border-border bg-surface px-4 py-3 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50">
                {e}
              </button>
            ))}
          </div>
        )}
        {items.map((it, i) =>
          it.role === "tool" ? (
            <div key={i}>
              <p className="flex items-center gap-1.5 px-1 text-[12px] text-subtle [&_svg]:size-3.5">
                {it.name === "run_report" ? <Table2 /> : it.name === "propose_action" ? <Sparkles /> : <Search />}
                {it.label}
                {it.failed && <Badge tone="warning">didn&apos;t work</Badge>}
              </p>
              {actions.filter((a) => a.toolUseId === it.toolUseId).map((a) => <ActionCard key={a.id} a={a} />)}
            </div>
          ) : it.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-[18px] bg-fg px-4 py-2.5 text-[14px] whitespace-pre-wrap text-bg">{it.text}</div>
          ) : it.role === "chart" ? (
            <AnswerChart key={i} chart={it.chart} className="block max-w-[95%] rounded-[18px] border border-border bg-surface px-4 py-3 text-[14px] [&>figcaption]:mb-2 [&>figcaption]:font-semibold" />
          ) : it.role === "docflow" ? (
            <DocFlow key={i} orgId={orgId} prompt={it.request} kindId={it.kindId ?? undefined} autoStart={false} />
          ) : it.role === "next" ? (
            <div key={i} className="flex flex-wrap gap-1.5">
              {it.prompts.map((p) => (
                <button key={p} type="button" disabled={!meta.connected} onClick={() => setText(p)} className="rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-fg">{p}</button>
              ))}
            </div>
          ) : (
            <div key={i} className="max-w-[95%] rounded-[18px] border border-border bg-surface px-4 py-3 text-[14px]">
              <Rich text={it.text} />
            </div>
          ),
        )}
        {asked && (
          <>
            <div className="ml-auto max-w-[85%] rounded-[18px] bg-fg px-4 py-2.5 text-[14px] whitespace-pre-wrap text-bg">{asked}</div>
            <p className="flex items-center gap-2 px-1 text-[13px] text-muted"><Spinner label="Working" /> Looking into it…</p>
          </>
        )}
        <div ref={end} />
      </div>
      <form
        className="sticky bottom-4 flex items-end gap-2 rounded-[20px] border border-border bg-surface p-2 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          aria-label="Your question"
          rows={2}
          value={text}
          autoFocus={!id && !!asked0}
          maxLength={4000}
          disabled={!meta.connected}
          placeholder={meta.connected ? "Ask about your sales, customers, stock, accounts, projects…" : "Connect an AI provider to start"}
          className="min-h-0 flex-1 resize-none border-0 shadow-none focus-visible:ring-0"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button type="submit" variant="primary" icon={<Send />} loading={send.isPending} disabled={!meta.connected || !text.trim()}>Ask</Button>
      </form>
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate(undefined)} loading={remove.isPending} destructive title="Delete this conversation?" description="The conversation and its suggestions are removed. Anything you already confirmed stays where it was saved." confirmLabel="Delete" />
    </div>
  );
}

function ActionCard({ a }: { a: Action }) {
  const confirm = useModuleAction<void, { link: string }>(() => ({ path: `actions/${a.id}/confirm` }), { success: "Done", also: ["crm", "work"] });
  const dismiss = useModuleAction<void>(() => ({ path: `actions/${a.id}/dismiss` }));
  const open = a.status === "proposed" || a.status === "failed";
  return (
    <div className={cx("mt-2 max-w-[95%] rounded-[16px] border px-4 py-3", open ? "border-accent bg-accent-soft" : "border-border bg-surface")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-subtle uppercase">{a.label}</p>
          <p className="text-[14px] font-medium">{a.summary}</p>
          {a.status === "failed" && <p className="mt-1 text-[12.5px] text-danger">{a.error}</p>}
        </div>
        {open ? (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={<X />} loading={dismiss.isPending} onClick={() => dismiss.mutate()}>Dismiss</Button>
            <Button size="sm" variant="primary" icon={<Check />} loading={confirm.isPending} onClick={() => confirm.mutate()}>{a.status === "failed" ? "Try again" : "Confirm"}</Button>
          </div>
        ) : a.status === "done" ? (
          <span className="flex items-center gap-2 text-[13px]">
            <Badge tone="success">Done</Badge>
            {a.result?.link && <Link href={a.result.link} className="font-medium underline">Open</Link>}
          </span>
        ) : (
          <Badge>{a.status === "running" ? "Working…" : "Dismissed"}</Badge>
        )}
      </div>
    </div>
  );
}

function Spans({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : p.code ? <code key={i} className="rounded bg-surface-2 px-1 text-[12.5px]">{p.text}</code> : <span key={i}>{p.text}</span>))}
    </>
  );
}

export function Rich({ text }: { text: string }) {
  return (
    <div className="space-y-2 leading-relaxed">
      {parseMarkdown(text).map((b, i) => {
        if (b.type === "p") return <p key={i}><Spans parts={b.inline} /></p>;
        if (b.type === "h") return <p key={i} className="font-semibold"><Spans parts={b.inline} /></p>;
        if (b.type !== "table") {
          const L = b.type;
          return <L key={i} className={cx("space-y-1 pl-5", L === "ul" ? "list-disc" : "list-decimal")}>{b.items.map((it, j) => <li key={j}><Spans parts={it} /></li>)}</L>;
        }
        return (
          <div key={i} className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-muted">{b.head.map((h, j) => <th key={j} className="py-1.5 pr-4 font-medium"><Spans parts={h} /></th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-b border-border last:border-0">{r.map((c, k) => <td key={k} className="py-1.5 pr-4 tabular-nums"><Spans parts={c} /></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function HistoryView() {
  const list = useModuleQuery<{ threads: { id: string; title: string; updatedAt: string }[] }>("threads");
  return (
    <div className="space-y-4">
      <PageHeader title="Conversations" description="Only you can see your conversations." actions={<ButtonLink href="/copilot" variant="primary" icon={<MessageSquarePlus />}>New</ButtonLink>} />
      {!list.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !list.data.threads.length ? (
        <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">No conversations yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {list.data.threads.map((t) => (
            <li key={t.id}>
              <Link href={`/copilot/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="truncate text-[14px] font-medium">{t.title}</span>
                <span className="shrink-0 text-[12px] text-subtle">{when(t.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { duplicate_bill: "Possible duplicate", large_bill: "Unusual amount", expense_spike: "Spending spike" };

function ChecksView() {
  const q = useModuleQuery<{ open: boolean; findings: Finding[] }>("checks");
  return (
    <div className="space-y-4">
      <PageHeader title="Checks" description="Fixed rules run on your books: the same supplier bill entered twice, bills far above a supplier's usual, and expense accounts well ahead of recent months. A finding is worth a look, not proof of a mistake." />
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !q.data.findings.length ? (
        <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">Nothing unusual found in the last year of bills or this month&apos;s spending.</p>
      ) : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {q.data.findings.map((f) => (
            <li key={f.kind + f.link}>
              <Link href={f.link} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[14px] font-medium">{f.title} <Badge tone={f.kind === "duplicate_bill" ? "danger" : "warning"}>{KIND_LABEL[f.kind] ?? f.kind}</Badge></span>
                  <span className="block text-[13px] text-muted">{f.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const USAGE_LABEL: Record<string, string> = { copilot: "Copilot questions", bill_extract: "Bills read" };

function ActivityView() {
  const q = useModuleQuery<{ usage: { kind: string; name: string | null; calls: number; tokens: number; costMicroUsd: number }[]; actions: { id: string; label: string; summary: string; status: string; error: string; decidedAt: string | null; name: string }[] }>("activity");
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;
  return (
    <div className="space-y-6">
      <PageHeader title="AI activity" description="The last 30 days of AI use in this workspace — model calls and their estimated cost, and every copilot suggestion that was carried out. Only owners and admins see this." />
      <section>
        <h2 className="mb-2 text-[14px] font-semibold">Usage</h2>
        {!q.data.usage.length ? (
          <p className="text-[13px] text-muted">No AI use in the last 30 days.</p>
        ) : (
          <div className="overflow-x-auto rounded-[20px] border border-border bg-surface">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border text-left text-muted"><tr><th className="px-4 py-2 font-medium">What</th><th className="px-4 py-2 font-medium">Who</th><th className="px-4 py-2 text-right font-medium">Calls</th><th className="px-4 py-2 text-right font-medium">Tokens</th><th className="px-4 py-2 text-right font-medium">Est. cost</th></tr></thead>
              <tbody className="divide-y divide-border">
                {q.data.usage.map((u, i) => (
                  <tr key={i}><td className="px-4 py-2">{USAGE_LABEL[u.kind] ?? u.kind}</td><td className="px-4 py-2">{u.name ?? "—"}</td><td className="px-4 py-2 text-right tabular-nums">{u.calls.toLocaleString("en-IN")}</td><td className="px-4 py-2 text-right tabular-nums">{u.tokens.toLocaleString("en-IN")}</td><td className="px-4 py-2 text-right tabular-nums">{usd(u.costMicroUsd)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-[14px] font-semibold">Suggestions carried out</h2>
        {!q.data.actions.length ? (
          <p className="text-[13px] text-muted">None in the last 30 days.</p>
        ) : (
          <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
            {q.data.actions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <span className="min-w-0"><b className="font-medium">{a.summary}</b> <span className="text-muted">· {a.label} · {a.name}</span>{a.status === "failed" && <span className="block text-danger">{a.error}</span>}</span>
                <span className="flex items-center gap-2"><Badge tone={a.status === "done" ? "success" : "danger"}>{a.status === "done" ? "Done" : "Failed"}</Badge><span className="text-subtle">{a.decidedAt ? when(a.decidedAt) : ""}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
