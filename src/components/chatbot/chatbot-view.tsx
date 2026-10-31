"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Bot, CheckCircle2, CircleDashed, FileText, Globe, Inbox, Link2, MessageSquare, Package, Plus, RefreshCw, ScrollText, Send, Sparkles, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, ErrorState, Field, Input, Notice, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime, timeAgo } from "@/lib/client/format";
import { useProject } from "@/lib/client/use-project";

type Settings = { enabled: boolean; name: string; greeting: string; instructions: string; handoffEmail: string; showLauncher: boolean };
type Source = { id: string; kind: "site" | "products" | "policies" | "text" | "url"; title: string; url: string | null; status: string; error: string | null; chunkCount: number; refreshedAt: string | null; createdAt: string };
type Data = { chatbot: Settings; sources: Source[]; indexed: boolean; ai: boolean; embeddings: boolean };
type Conversation = { id: string; status: "open" | "needs_reply" | "closed"; email: string | null; messageCount: number; createdAt: string; updatedAt: string };
type Message = { id: string; role: "user" | "assistant" | "staff"; text: string; mode: string | null; sources: { title: string; url: string | null }[] | null; createdAt: string };
type Answer = { text: string; mode: "ai" | "search" | "none"; sources: { title: string; url: string | null }[] };

const SOURCE_ICON: Record<Source["kind"], React.ReactNode> = {
  site: <Globe className="size-4" />,
  products: <Package className="size-4" />,
  policies: <ScrollText className="size-4" />,
  text: <FileText className="size-4" />,
  url: <Link2 className="size-4" />,
};
const BUILT_IN = new Set(["site", "products", "policies"]);

export function ChatbotView({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const perms = project.data?.permissions ?? [];
  const canEdit = perms.includes("project:update");
  const canInbox = perms.includes("submissions:read");
  const q = useQuery({ queryKey: ["chatbot", projectId], queryFn: () => api<Data>(`/api/v1/projects/${projectId}/chatbot`), refetchInterval: (query) => (query.state.data?.sources.some((s) => s.status === "pending" || s.status === "indexing") ? 2000 : false) });
  const [tab, setTab] = useState<"setup" | "knowledge" | "inbox">("setup");
  const live = project.data?.project.productionDeploymentId;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-xl">Chatbot</h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-muted">An assistant on your published site that answers from your pages, products and policies — and hands over to your team when it isn&apos;t sure.</p>
        </div>
        {live && q.data?.chatbot.enabled && (
          <ButtonLink href={`/sites/${live}/chat`} external icon={<ArrowUpRight className="size-3.5" />}>
            Open live chat
          </ButtonLink>
        )}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[
          { value: "setup", label: <><Bot className="size-3.5" /> Assistant</> },
          { value: "knowledge", label: <><Sparkles className="size-3.5" /> Knowledge</> },
          ...(canInbox ? [{ value: "inbox" as const, label: <><Inbox className="size-3.5" /> Conversations</> }] : []),
        ]}
      />
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-64" />
      ) : tab === "setup" ? (
        <SetupTab key={JSON.stringify(q.data.chatbot)} projectId={projectId} data={q.data} canEdit={canEdit} published={!!live} />
      ) : tab === "knowledge" ? (
        <KnowledgeTab projectId={projectId} data={q.data} canEdit={canEdit} />
      ) : (
        <InboxTab projectId={projectId} />
      )}
    </div>
  );
}

function SetupTab({ projectId, data, canEdit, published }: { projectId: string; data: Data; canEdit: boolean; published: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [s, setS] = useState<Settings>(data.chatbot);
  const dirty = JSON.stringify(s) !== JSON.stringify(data.chatbot);
  const save = useMutation({
    mutationFn: (next: Settings) => api(`/api/v1/projects/${projectId}/chatbot`, { method: "PUT", body: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chatbot", projectId] });
      toast({ tone: "success", title: "Chatbot saved" });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) }),
  });
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="grid content-start gap-4">
        {!data.ai && (
          <Notice tone="neutral" title="Search mode">
            No AI provider is configured, so the bot replies with the best matching passages from your site and links to them. Add an Anthropic key in AI settings for written answers.
          </Notice>
        )}
        {!published && <Notice tone="warning" title="Not live yet">Publish the site to production to put the chatbot on it.</Notice>}
        <Card className="grid gap-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold">Show on the published site</h2>
              <p className="text-[13px] text-muted">Adds a /chat page{s.showLauncher ? " and a floating “Chat” button on every page" : ""}.</p>
            </div>
            <Switch checked={s.enabled} onChange={(v) => set("enabled", v)} label="Enable chatbot" disabled={!canEdit} />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <p className="text-[13px]">Floating chat button</p>
            <Switch checked={s.showLauncher} onChange={(v) => set("showLauncher", v)} label="Show floating chat button" disabled={!canEdit} />
          </div>
        </Card>
        <Card className="grid gap-4 p-5">
          <Field label="Name">{(p) => <Input {...p} value={s.name} maxLength={40} onChange={(e) => set("name", e.target.value)} disabled={!canEdit} />}</Field>
          <Field label="Greeting">{(p) => <Textarea {...p} rows={2} value={s.greeting} maxLength={300} onChange={(e) => set("greeting", e.target.value)} disabled={!canEdit} />}</Field>
          <Field label="Extra instructions" hint="Tone, what to recommend, what to avoid. The bot still only states facts from your knowledge sources.">
            {(p) => <Textarea {...p} rows={4} value={s.instructions} maxLength={2000} onChange={(e) => set("instructions", e.target.value)} disabled={!canEdit} placeholder="Keep answers warm and short. Suggest booking a table for groups over six." />}
          </Field>
          <Field label="Hand-over email" hint="Where “Talk to a person” requests go. Leave empty to use the store email.">
            {(p) => <Input {...p} type="email" value={s.handoffEmail} onChange={(e) => set("handoffEmail", e.target.value)} disabled={!canEdit} placeholder="team@yourbusiness.com" />}
          </Field>
          {canEdit && (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={!dirty} onClick={() => setS(data.chatbot)}>Reset</Button>
              <Button variant="primary" disabled={!dirty || !s.name.trim()} loading={save.isPending} onClick={() => save.mutate(s)}>Save</Button>
            </div>
          )}
        </Card>
      </div>
      <TestConsole projectId={projectId} name={s.name} greeting={s.greeting} canEdit={canEdit} />
    </div>
  );
}

function TestConsole({ projectId, name, greeting, canEdit }: { projectId: string; name: string; greeting: string; canEdit: boolean }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<{ q: string; a: Answer }[]>([]);
  const ask = useMutation({
    mutationFn: (qn: string) => api<Answer>(`/api/v1/projects/${projectId}/chatbot/test`, { method: "POST", body: { question: qn } }),
    onSuccess: (a, qn) => {
      setTurns((t) => [...t, { q: qn, a }].slice(-8));
      setQuestion("");
    },
  });
  return (
    <Card className="flex h-[560px] flex-col overflow-hidden p-0">
      <div className="glass-bar flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-accent-fg"><Bot className="size-4" /></span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{name || "Assistant"}</p>
          <p className="text-[11px] text-muted">Test console · not saved as a conversation</p>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <Bubble role="assistant">{greeting || "Hi! How can I help?"}</Bubble>
        {turns.map((t, i) => (
          <div key={i} className="space-y-3">
            <Bubble role="user">{t.q}</Bubble>
            <Bubble role="assistant" mode={t.a.mode} sources={t.a.sources}>{t.a.text}</Bubble>
          </div>
        ))}
        {ask.isError && <p className="text-[12px] text-danger">{errorMessage(ask.error)}</p>}
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) ask.mutate(question.trim());
        }}
      >
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={canEdit ? "Ask what a visitor would…" : "Editors can test the bot"} maxLength={1000} disabled={!canEdit} aria-label="Test question" />
        <Button type="submit" variant="primary" icon={<Send className="size-3.5" />} loading={ask.isPending} disabled={!canEdit || !question.trim()} aria-label="Send" />
      </form>
    </Card>
  );
}

function Bubble({ role, children, mode, sources }: { role: "user" | "assistant" | "staff"; children: React.ReactNode; mode?: string | null; sources?: { title: string; url: string | null }[] | null }) {
  const mine = role === "user";
  return (
    <div className={cx("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <div className={cx("max-w-[88%] rounded-[16px] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap", mine ? "bg-accent text-accent-fg" : role === "staff" ? "border border-border bg-surface" : "bg-surface-2")}>
        {role === "staff" && <span className="mb-1 block text-[11px] font-semibold text-muted">Team reply</span>}
        {children}
      </div>
      {!mine && (mode || sources?.length) ? (
        <div className="flex max-w-[88%] flex-wrap items-center gap-1.5 text-[11px] text-muted">
          {mode && <Badge tone={mode === "ai" ? "accent" : "neutral"}>{mode === "ai" ? "AI answer" : mode === "search" ? "From search" : "No match"}</Badge>}
          {sources?.map((s, i) => (
            <span key={i} className="truncate">{s.title}{s.url ? ` · ${s.url}` : ""}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KnowledgeTab({ projectId, data, canEdit }: { projectId: string; data: Data; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState<null | "text" | "url">(null);
  const [removing, setRemoving] = useState<Source | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["chatbot", projectId] });
  const reindex = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}/chatbot/reindex`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      toast({ tone: "success", title: "Rebuilding the knowledge base" });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't rebuild", description: errorMessage(e) }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/v1/projects/${projectId}/chatbot/sources/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't remove", description: errorMessage(e) }),
  });
  const chunks = data.sources.reduce((n, s) => n + s.chunkCount, 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          {data.sources.length} sources · {chunks} passages · {data.embeddings ? "keyword + semantic search" : "keyword search with typo tolerance"}
        </p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button icon={<RefreshCw className="size-3.5" />} loading={reindex.isPending} onClick={() => reindex.mutate()}>Rebuild</Button>
            <Button icon={<Link2 className="size-3.5" />} onClick={() => setAdding("url")}>Add web page</Button>
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding("text")}>Add notes</Button>
          </div>
        )}
      </div>
      <Card className="divide-y divide-border p-0">
        {data.sources.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-muted">{SOURCE_ICON[s.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{s.title}</p>
              <p className="truncate text-[12px] text-muted">
                {BUILT_IN.has(s.kind) ? "Kept in sync automatically" : s.url ?? "Your notes"}
                {s.refreshedAt ? ` · updated ${timeAgo(s.refreshedAt)}` : ""}
              </p>
              {s.error && <p className="mt-0.5 text-[12px] text-danger">{s.error}</p>}
            </div>
            <SourceStatus s={s} />
            {canEdit && !BUILT_IN.has(s.kind) && (
              <Button variant="ghost" size="sm" icon={<Trash2 className="size-3.5" />} aria-label={`Remove ${s.title}`} onClick={() => setRemoving(s)} />
            )}
          </div>
        ))}
      </Card>
      <AddSourceDialog projectId={projectId} kind={adding} onClose={() => setAdding(null)} onAdded={refresh} />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && del.mutate(removing.id)}
        title={`Remove “${removing?.title}”?`}
        description="The chatbot will stop using this source. You can add it again later."
        confirmLabel="Remove"
        destructive
        loading={del.isPending}
      />
    </div>
  );
}

function SourceStatus({ s }: { s: Source }) {
  if (s.status === "ready") return <Badge tone="success"><CheckCircle2 className="size-3" /> {s.chunkCount} passages</Badge>;
  if (s.status === "failed") return <Badge tone="danger"><XCircle className="size-3" /> Failed</Badge>;
  return <Badge><CircleDashed className="size-3 animate-spin" /> Indexing</Badge>;
}

function AddSourceDialog({ projectId, kind, onClose, onAdded }: { projectId: string; kind: null | "text" | "url"; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("https://");
  const close = () => {
    setTitle("");
    setContent("");
    setUrl("https://");
    onClose();
  };
  const add = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}/chatbot/sources`, { method: "POST", body: kind === "url" ? { kind, title, url } : { kind, title, content } }),
    onSuccess: () => {
      onAdded();
      toast({ tone: "success", title: "Source added", description: "It's being indexed now." });
      close();
    },
  });
  return (
    <Dialog open={!!kind} onClose={close} title={kind === "url" ? "Add a web page" : "Add notes"} description={kind === "url" ? "A public page the bot should learn from, like a menu or help article." : "FAQs, opening hours, anything visitors ask about."}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Title">{(p) => <Input {...p} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "url" ? "Optional" : "Opening hours"} required={kind === "text"} />}</Field>
        {kind === "url" ? (
          <Field label="Address">{(p) => <Input {...p} type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />}</Field>
        ) : (
          <Field label="Text">{(p) => <Textarea {...p} rows={8} value={content} onChange={(e) => setContent(e.target.value)} required />}</Field>
        )}
        {add.isError && <p className="text-[13px] text-danger">{errorMessage(add.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={add.isPending}>Add</Button>
        </div>
      </form>
    </Dialog>
  );
}

function InboxTab({ projectId }: { projectId: string }) {
  const q = useQuery({ queryKey: ["chat-conversations", projectId], queryFn: () => api<{ conversations: Conversation[] }>(`/api/v1/projects/${projectId}/chatbot/conversations`), refetchInterval: 15_000 });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const list = q.data.conversations;
  if (!list.length) return <EmptyState icon={<MessageSquare className="size-5" />} title="No conversations yet" description="When visitors chat on your site, their questions show up here." />;
  const selected = open ?? list[0].id;
  return (
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      <Card className="max-h-[600px] divide-y divide-border overflow-y-auto p-0">
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => setOpen(c.id)} className={cx("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2", selected === c.id && "bg-surface-2")}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{c.email ?? "Anonymous visitor"}</p>
              <p className="text-[12px] text-muted">{c.messageCount} messages · {timeAgo(c.updatedAt)}</p>
            </div>
            {c.status === "needs_reply" ? <Badge tone="warning">Needs reply</Badge> : c.status === "closed" ? <Badge>Closed</Badge> : null}
          </button>
        ))}
      </Card>
      <Thread key={selected} projectId={projectId} id={selected} />
    </div>
  );
}

function Thread({ projectId, id }: { projectId: string; id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["chat-conversation", projectId, id], queryFn: () => api<{ conversation: Conversation; messages: Message[] }>(`/api/v1/projects/${projectId}/chatbot/conversations/${id}`) });
  const [text, setText] = useState("");
  const reply = useMutation({
    mutationFn: (close: boolean) => api<{ emailed: boolean }>(`/api/v1/projects/${projectId}/chatbot/conversations/${id}/reply`, { method: "POST", body: { text, close } }),
    onSuccess: (r) => {
      setText("");
      qc.invalidateQueries({ queryKey: ["chat-conversation", projectId, id] });
      qc.invalidateQueries({ queryKey: ["chat-conversations", projectId] });
      toast({ tone: "success", title: r.emailed ? "Reply sent by email" : "Saved", description: r.emailed ? undefined : "The visitor didn't leave an email; they'll see it next time they open the chat." });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't send", description: errorMessage(e) }),
  });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const c = q.data.conversation;
  return (
    <Card className="flex max-h-[600px] flex-col p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{c.email ?? "Anonymous visitor"}</p>
          <p className="text-[12px] text-muted">Started {dateTime(c.createdAt)}</p>
        </div>
        {c.status !== "closed" && <Button size="sm" loading={reply.isPending && !text} onClick={() => reply.mutate(true)}>Close</Button>}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {q.data.messages.map((m) => (
          <Bubble key={m.id} role={m.role} mode={m.mode} sources={m.sources}>{m.text}</Bubble>
        ))}
      </div>
      <form
        className="grid gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          reply.mutate(false);
        }}
      >
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder={c.email ? `Reply to ${c.email}…` : "Write a reply…"} aria-label="Reply" />
        <div className="flex justify-end gap-2">
          <Button disabled={!text.trim()} onClick={() => reply.mutate(true)}>Reply & close</Button>
          <Button type="submit" variant="primary" icon={<Send className="size-3.5" />} disabled={!text.trim()} loading={reply.isPending && !!text}>Reply</Button>
        </div>
      </form>
    </Card>
  );
}
