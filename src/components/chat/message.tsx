"use client";

// One message: its text (tokens drawn as chips, never HTML), the interactive
// card it carries (poll, checklist, decision, approval, shared record, call,
// meeting), files, reactions, its thread summary, and the actions on hover.
import { BarChart3, Bookmark, BookmarkCheck, CalendarPlus, Check, CheckCircle2, CircleDot, Clock3, Copy, CornerUpRight, ExternalLink, FileText, Forward, Gavel, Link2, ListChecks, Mail, MessageSquareReply, MoreHorizontal, Pencil, Phone, Pin, PinOff, ShieldCheck, SmilePlus, Trash2, TriangleAlert, Video, XCircle } from "lucide-react";
import Link from "next/link";
import { Fragment, memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Menu, type MenuItem } from "@/components/ui/overlays";
import { cx } from "@/components/ui/primitives";
import type { ChannelOut, MessageOut, PersonOut } from "@/lib/chat/api";
import { QUICK_REACTIONS } from "@/lib/chat/model";
import { bigEmoji, parse, plain, type Block, type Token } from "@/lib/chat/text";
import { copyText } from "@/lib/client/copy";
import { Avatar, clock, fileSize, longWhen, shortWhen } from "./shared";

export type Ops = {
  me: string;
  people: Map<string, PersonOut>;
  channel: ChannelOut;
  admin: boolean;
  react: (m: MessageOut, emoji: string, on: boolean) => void;
  reply: (m: MessageOut) => void;
  edit: (m: MessageOut) => void;
  remove: (m: MessageOut) => void;
  pin: (m: MessageOut, on: boolean) => void;
  save: (m: MessageOut, on: boolean) => void;
  remind: (m: MessageOut) => void;
  unread: (m: MessageOut) => void;
  forward: (m: MessageOut) => void;
  task: (m: MessageOut) => void;
  email: ((m: MessageOut) => void) | null;
  vote: (m: MessageOut, choice: string, on: boolean, note?: string) => void;
  settle: (m: MessageOut, state: string) => void;
  approve: (m: MessageOut, choice: "approve" | "reject") => void;
  calendar: (m: MessageOut) => void;
  emojiPicker: (m: MessageOut, anchor: HTMLElement) => void;
  tag: (t: string) => void;
  copyLink: (m: MessageOut) => void;
  /** Copy the message's text (with feedback); falls back to a silent copy. */
  copyText?: (m: MessageOut) => void;
  /** The reader is a guest: only what a guest can do shows (react, reply, vote, edit and delete their own). */
  guest?: boolean;
};

const nameOf = (ops: Ops, id: string | null) => (id ? (ops.people.get(id)?.name ?? "Someone") : "Cloudesk");

// ── Text ────────────────────────────────────────────────────────────────────

function Inline({ tokens, ops }: { tokens: Token[]; ops: Ops }) {
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.t) {
          case "text":
            return <Fragment key={i}>{t.v}</Fragment>;
          case "bold":
            return <strong key={i} className="font-semibold"><Inline tokens={t.children} ops={ops} /></strong>;
          case "italic":
            return <em key={i}><Inline tokens={t.children} ops={ops} /></em>;
          case "strike":
            return <s key={i} className="text-muted"><Inline tokens={t.children} ops={ops} /></s>;
          case "code":
            return <code key={i} className="rounded-[5px] bg-surface-2 px-1 py-px font-mono text-[0.86em] text-rose-700 dark:text-rose-300">{t.v}</code>;
          case "user": {
            const mine = t.id === ops.me;
            return <span key={i} title={ops.people.get(t.id)?.email} className={cx("rounded-[5px] px-1 font-medium", mine ? "bg-amber-200/70 text-amber-950 dark:bg-amber-400/25 dark:text-amber-100" : "bg-sky-500/12 text-sky-700 dark:text-sky-300")}>@{ops.people.get(t.id)?.name ?? t.name}</span>;
          }
          case "everyone":
            return <span key={i} className="rounded-[5px] bg-amber-200/70 px-1 font-medium text-amber-950 dark:bg-amber-400/25 dark:text-amber-100">{t.v}</span>;
          case "record":
            return <RecordChip key={i} kind={t.kind} id={t.id} label={t.label} />;
          case "tag":
            return <button key={i} type="button" onClick={() => ops.tag(t.v)} className="font-medium text-violet-700 hover:underline dark:text-violet-300">#{t.v}</button>;
          case "link":
            return t.href.startsWith("/") ? <Link key={i} href={t.href} className="text-sky-700 underline decoration-sky-700/30 underline-offset-2 hover:decoration-sky-700 dark:text-sky-400">{t.v}</Link> : <a key={i} href={t.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-sky-700 underline decoration-sky-700/30 underline-offset-2 hover:decoration-sky-700 dark:text-sky-400">{t.v}</a>;
        }
      })}
    </>
  );
}

/** Record chips find their link on the message (set when it was posted). */
const RecordLinkCtx = { links: new Map<string, string>() };
function RecordChip({ kind, id, label }: { kind: string; id: string; label: string }) {
  const href = RecordLinkCtx.links.get(`${kind}/${id}`);
  const cls = "inline-flex items-center gap-1 rounded-[6px] border border-violet-500/25 bg-violet-500/8 px-1.5 py-px align-baseline text-[0.92em] font-medium text-violet-800 dark:text-violet-200";
  return href ? <Link href={href} className={cx(cls, "hover:bg-violet-500/15")}><Link2 className="size-3" />{label}</Link> : <span className={cls}><Link2 className="size-3" />{label}</span>;
}

export function RichText({ body, ops, records }: { body: string; ops: Ops; records?: MessageOut["mentions"]["records"] }) {
  for (const r of records ?? []) if (r.link) RecordLinkCtx.links.set(`${r.kind}/${r.id}`, r.link);
  if (bigEmoji(body)) return <p className="text-[34px] leading-tight">{body}</p>;
  const blocks: Block[] = parse(body);
  return (
    <div className="grid gap-1.5 text-[14px] leading-[1.55] break-words [overflow-wrap:anywhere]">
      {blocks.map((b, i) =>
        b.b === "p" ? <p key={i} className="whitespace-pre-wrap"><Inline tokens={b.tokens} ops={ops} /></p>
          : b.b === "quote" ? <blockquote key={i} className="border-l-[3px] border-border pl-3 whitespace-pre-wrap text-muted"><Inline tokens={b.tokens} ops={ops} /></blockquote>
          : b.b === "code" ? <pre key={i} className="overflow-x-auto rounded-[10px] bg-zinc-950 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-zinc-100">{b.v}</pre>
          : b.b === "ul" ? <ul key={i} className="ml-5 list-disc space-y-0.5">{b.items.map((it, j) => <li key={j}><Inline tokens={it} ops={ops} /></li>)}</ul>
          : <ol key={i} className="ml-5 list-decimal space-y-0.5">{b.items.map((it, j) => <li key={j}><Inline tokens={it} ops={ops} /></li>)}</ol>,
      )}
    </div>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────

function CardShell({ icon, tone, title, children, footer }: { icon: ReactNode; tone: string; title: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mt-1 max-w-[560px] overflow-hidden rounded-[16px] border border-border bg-[var(--surface-solid)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        <span className={cx("mt-px grid size-7 shrink-0 place-items-center rounded-[9px] [&>svg]:size-4", tone)}>{icon}</span>
        <div className="min-w-0 flex-1 pt-0.5 text-[14px] font-semibold leading-snug">{title}</div>
      </div>
      <div className="px-3.5 pt-2 pb-3">{children}</div>
      {footer && <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2/50 px-3.5 py-2 text-[12px] text-muted">{footer}</div>}
    </div>
  );
}

function Faces({ ids, ops, max = 5 }: { ids: string[]; ops: Ops; max?: number }) {
  if (!ids.length) return null;
  return (
    <span className="flex -space-x-1.5" title={ids.map((u) => nameOf(ops, u)).join(", ")}>
      {ids.slice(0, max).map((u) => <Avatar key={u} id={u} name={nameOf(ops, u)} size={20} ring />)}
      {ids.length > max && <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-[9px] font-semibold ring-2 ring-[var(--surface-solid)]">+{ids.length - max}</span>}
    </span>
  );
}

function Poll({ m, ops }: { m: MessageOut; ops: Ops }) {
  const d = m.data as { question: string; options: { id: string; label: string }[]; multi: boolean; anonymous: boolean; closed: boolean; closesAt: string | null };
  const [now] = useState(() => Date.now());
  const closed = d.closed || (!!d.closesAt && new Date(d.closesAt).getTime() < now);
  const voters = new Set(m.votes.map((v) => v.userId || `anon-${v.at}`)).size;
  const mine = new Set(m.votes.filter((v) => v.userId === ops.me).map((v) => v.choice));
  const counts = new Map(d.options.map((o) => [o.id, m.votes.filter((v) => v.choice === o.id).length]));
  const top = Math.max(0, ...counts.values());
  const canClose = !closed && (m.authorId === ops.me || ops.admin);
  return (
    <CardShell icon={<BarChart3 />} tone="bg-sky-500/12 text-sky-600" title={d.question} footer={<><span>{voters} {voters === 1 ? "vote" : "votes"}{d.multi ? " · pick any" : ""}{d.anonymous ? " · anonymous" : ""}</span>{closed ? <span className="font-medium text-fg">Closed</span> : d.closesAt ? <span>Closes {longWhen(d.closesAt)}</span> : null}{canClose && <button type="button" className="ml-auto font-medium text-fg hover:underline" onClick={() => ops.settle(m, "closed")}>Close poll</button>}</>}>
      <div className="grid gap-1.5" role="group" aria-label={d.question}>
        {d.options.map((o) => {
          const n = counts.get(o.id) ?? 0;
          const pct = voters ? Math.round((n / Math.max(1, m.votes.length)) * 100) : 0;
          const chosen = mine.has(o.id);
          const winner = closed && n === top && n > 0;
          return (
            <button key={o.id} type="button" disabled={closed} aria-pressed={chosen} onClick={() => ops.vote(m, o.id, !chosen)} className={cx("group relative overflow-hidden rounded-[11px] border px-3 py-2 text-left text-[13.5px] transition-colors disabled:cursor-default", chosen ? "border-sky-500/60 bg-sky-500/5" : "border-border hover:border-fg/25")}>
              <span aria-hidden className={cx("absolute inset-y-0 left-0 transition-[width] duration-500", winner ? "bg-emerald-500/15" : chosen ? "bg-sky-500/15" : "bg-surface-2")} style={{ width: `${pct}%` }} />
              <span className="relative flex items-center gap-2">
                <span className={cx("grid size-4 shrink-0 place-items-center border", d.multi ? "rounded-[4px]" : "rounded-full", chosen ? "border-sky-600 bg-sky-600 text-white" : "border-fg/30")}>{chosen && <Check className="size-3" />}</span>
                <span className="min-w-0 flex-1 font-medium">{o.label}</span>
                {!d.anonymous && <Faces ids={m.votes.filter((v) => v.choice === o.id && v.userId).map((v) => v.userId)} ops={ops} max={3} />}
                <span className="w-10 text-right text-[12px] font-semibold tabular-nums text-muted">{pct}%</span>
              </span>
            </button>
          );
        })}
      </div>
    </CardShell>
  );
}

function Checklist({ m, ops }: { m: MessageOut; ops: Ops }) {
  const d = m.data as { title: string; items: { id: string; label: string }[] };
  const done = new Map(m.votes.map((v) => [v.choice, v.userId]));
  const n = d.items.filter((i) => done.has(i.id)).length;
  return (
    <CardShell icon={<ListChecks />} tone="bg-emerald-500/12 text-emerald-600" title={<span className="flex items-center gap-2">{d.title}<span className="text-[12px] font-medium text-muted">{n}/{d.items.length}</span></span>} footer={<span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${(n / d.items.length) * 100}%` }} /></span>}>
      <ul className="grid gap-0.5">
        {d.items.map((it) => {
          const by = done.get(it.id);
          return (
            <li key={it.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[9px] px-1.5 py-1 text-[13.5px] hover:bg-surface-2">
                <input type="checkbox" checked={!!by} onChange={() => ops.vote(m, it.id, !by)} className="size-4 rounded accent-emerald-600" />
                <span className={cx("flex-1", by && "text-muted line-through")}>{it.label}</span>
                {by && <span className="text-[11px] text-subtle">{nameOf(ops, by).split(" ")[0]}</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}

const DECISION_STATE: Record<string, { label: string; cls: string }> = {
  proposed: { label: "Proposed", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  agreed: { label: "Agreed", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  rejected: { label: "Not agreed", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
  withdrawn: { label: "Withdrawn", cls: "bg-surface-2 text-muted" },
};

function Decision({ m, ops }: { m: MessageOut; ops: Ops }) {
  const d = m.data as { text: string; state: string };
  const st = DECISION_STATE[d.state] ?? DECISION_STATE.proposed!;
  const mine = m.votes.find((v) => v.userId === ops.me)?.choice;
  const open = d.state === "proposed";
  const can = m.authorId === ops.me || ops.admin;
  const by = (c: string) => m.votes.filter((v) => v.choice === c);
  return (
    <CardShell
      icon={<Gavel />}
      tone="bg-violet-500/12 text-violet-600"
      title={<span className="flex flex-wrap items-center gap-2"><span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span><span className="text-[12px] font-medium text-muted">Decision</span></span>}
      footer={open && can ? <><span>Settle it:</span><button type="button" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400" onClick={() => ops.settle(m, "agreed")}>Agreed</button><button type="button" className="font-medium text-red-700 hover:underline dark:text-red-400" onClick={() => ops.settle(m, "rejected")}>Not agreed</button><button type="button" className="font-medium hover:underline" onClick={() => ops.settle(m, "withdrawn")}>Withdraw</button></> : undefined}
    >
      <p className="text-[14px] leading-snug whitespace-pre-wrap">{d.text}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {(["agree", "object", "abstain"] as const).map((c) => {
          const n = by(c);
          return (
            <button key={c} type="button" disabled={!open} aria-pressed={mine === c} onClick={() => ops.vote(m, c, mine !== c)} title={n.map((v) => `${nameOf(ops, v.userId)}${v.note ? `: ${v.note}` : ""}`).join("\n")} className={cx("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium disabled:opacity-70", mine === c ? (c === "agree" ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : c === "object" ? "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300" : "border-fg/30 bg-surface-2") : "border-border hover:bg-surface-2")}>
              {c === "agree" ? "👍 Agree" : c === "object" ? "✋ Object" : "🤷 Abstain"}
              {n.length > 0 && <span className="tabular-nums text-muted">{n.length}</span>}
            </button>
          );
        })}
      </div>
      {by("object").some((v) => v.note) && <ul className="mt-2 grid gap-1 text-[12.5px] text-muted">{by("object").filter((v) => v.note).map((v) => <li key={v.userId}><b className="font-medium text-fg">{nameOf(ops, v.userId)}:</b> {v.note}</li>)}</ul>}
    </CardShell>
  );
}

function Approval({ m, ops }: { m: MessageOut; ops: Ops }) {
  const d = m.data as { title: string; details: string; amount: string; approvers: string[]; state: string; decidedBy?: string; decidedAt?: string };
  const mineToDecide = d.state === "pending" && d.approvers.includes(ops.me);
  const tone = d.state === "approved" ? "bg-emerald-500/12 text-emerald-600" : d.state === "rejected" ? "bg-red-500/12 text-red-600" : "bg-amber-500/12 text-amber-600";
  const note = m.votes.find((v) => v.userId === d.decidedBy)?.note;
  return (
    <CardShell
      icon={d.state === "approved" ? <CheckCircle2 /> : d.state === "rejected" ? <XCircle /> : <ShieldCheck />}
      tone={tone}
      title={<span className="flex flex-wrap items-baseline gap-x-2">{d.title}{d.amount && <span className="text-[13px] font-semibold text-muted tabular-nums">{d.amount}</span>}</span>}
      footer={<><span>Approver{d.approvers.length > 1 ? "s" : ""}:</span><Faces ids={d.approvers} ops={ops} /><span className="ml-auto font-medium text-fg">{d.state === "pending" ? "Waiting" : `${d.state === "approved" ? "Approved" : "Rejected"} by ${nameOf(ops, d.decidedBy ?? null)}${d.decidedAt ? ` · ${shortWhen(d.decidedAt)}` : ""}`}</span></>}
    >
      {d.details && <p className="text-[13.5px] whitespace-pre-wrap text-fg/85">{d.details}</p>}
      {note && <p className="mt-1.5 rounded-[9px] bg-surface-2 px-2.5 py-1.5 text-[12.5px]">“{note}”</p>}
      {mineToDecide && (
        <div className="mt-2.5 flex gap-2">
          <button type="button" onClick={() => ops.approve(m, "approve")} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700"><Check className="size-3.5" /> Approve</button>
          <button type="button" onClick={() => ops.approve(m, "reject")} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3.5 text-[12.5px] font-semibold hover:bg-surface-2"><XCircle className="size-3.5" /> Reject</button>
        </div>
      )}
    </CardShell>
  );
}

function RecordCard({ m }: { m: MessageOut }) {
  const d = m.data as { kind: string; title: string; sub: string; link: string; module: string; fields: { label: string; value: string }[] };
  const inner = (
    <div className="mt-1 flex max-w-[560px] overflow-hidden rounded-[16px] border border-border bg-[var(--surface-solid)] transition-shadow hover:shadow-md">
      <span className="w-1 shrink-0 bg-gradient-to-b from-violet-500 to-sky-500" />
      <div className="min-w-0 flex-1 px-3.5 py-3">
        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">{d.module || d.kind}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[14.5px] font-semibold">{d.title}{d.link && <ExternalLink className="size-3.5 shrink-0 text-subtle" />}</p>
        {d.sub && <p className="mt-0.5 text-[13px] text-muted">{d.sub}</p>}
        {d.fields.length > 0 && (
          <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 @md/chat:grid-cols-3">
            {d.fields.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[11px] text-subtle">{f.label}</dt>
                <dd className="truncate text-[13px] font-medium">{f.value || "—"}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
  return d.link ? <Link href={d.link} className="block">{inner}</Link> : inner;
}

function CallCard({ m, ops }: { m: MessageOut; ops: Ops }) {
  const d = m.data as { title: string; url: string; startedBy: string };
  return (
    <CardShell icon={<Video />} tone="bg-indigo-500/12 text-indigo-600" title={d.title} footer={<span>Started by {nameOf(ops, d.startedBy)} · {clock(m.createdAt)} · Jitsi Meet (opens in a new tab)</span>}>
      <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-full bg-indigo-600 px-4 text-[13px] font-semibold text-white hover:bg-indigo-700"><Phone className="size-3.5" /> Join the call</a>
    </CardShell>
  );
}

function EventCard({ m, ops }: { m: MessageOut; ops: Ops }) {
  const d = m.data as { title: string; start: string; end: string; meetingUrl: string };
  const going = m.votes.filter((v) => v.choice === "going").map((v) => v.userId);
  const mine = going.includes(ops.me);
  const s = new Date(d.start);
  return (
    <CardShell icon={<CalendarPlus />} tone="bg-rose-500/12 text-rose-600" title={d.title} footer={<>{going.length > 0 ? <><Faces ids={going} ops={ops} /><span>{going.length} added it to their calendar</span></> : <span>Nobody&apos;s added it yet</span>}</>}>
      <div className="flex items-center gap-3">
        <span className="grid w-12 shrink-0 overflow-hidden rounded-[10px] border border-border text-center">
          <span className="bg-rose-600 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">{s.toLocaleDateString("en-IN", { month: "short" })}</span>
          <span className="py-0.5 text-[18px] font-semibold leading-tight">{s.getDate()}</span>
        </span>
        <div className="text-[13px]">
          <p className="font-medium">{s.toLocaleDateString("en-IN", { weekday: "long" })}, {clock(d.start)} – {clock(d.end)}</p>
          {d.meetingUrl && <a href={d.meetingUrl} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline dark:text-sky-400">Meeting link</a>}
        </div>
      </div>
      <button type="button" disabled={mine} onClick={() => ops.calendar(m)} className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[12.5px] font-semibold hover:bg-surface-2 disabled:opacity-60">{mine ? <><Check className="size-3.5" /> In your calendar</> : <><CalendarPlus className="size-3.5" /> Add to my calendar</>}</button>
    </CardShell>
  );
}

function Files({ m, base }: { m: MessageOut; base: string }) {
  if (!m.files.length) return null;
  const images = m.files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.mime));
  const others = m.files.filter((f) => !images.includes(f));
  return (
    <div className="mt-1.5 grid gap-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((f) => (
            <a key={f.id} href={`${base}/files/${f.id}`} target="_blank" rel="noopener" className="block overflow-hidden rounded-[12px] border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${base}/files/${f.id}`} alt={f.filename} loading="lazy" className="max-h-60 max-w-[280px] object-cover" />
            </a>
          ))}
        </div>
      )}
      {others.map((f) => (
        <a key={f.id} href={`${base}/files/${f.id}?download=1`} className="flex max-w-[380px] items-center gap-2.5 rounded-[12px] border border-border bg-[var(--surface-solid)] px-3 py-2 hover:bg-surface-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-sky-500/10 text-sky-600"><FileText className="size-4.5" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{f.filename}</span><span className="text-[11.5px] text-muted">{fileSize(f.size)}</span></span>
        </a>
      ))}
    </div>
  );
}

// ── The message ─────────────────────────────────────────────────────────────

/** Mice hover; fingers don't — on touch screens a tap opens the action sheet instead of a hover bar. */
const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const INTERACTIVE = "button, a, input, label, textarea, select, summary, [role=button], [role=menu], [role=dialog], [contenteditable=true]";

/** Everything you can do with a message, for the ⋯ menu and the touch sheet alike. */
function actionsFor(m: MessageOut, ops: Ops, inThread: boolean, sheet: boolean): MenuItem[] {
  const mine = m.authorId === ops.me;
  const canPost = ops.channel.member && !ops.channel.archived;
  const copy = () => (ops.copyText ? ops.copyText(m) : void copyText(plain(m.body)));
  const reply: MenuItem[] = sheet && !inThread && canPost ? [{ label: m.replyCount ? `Open thread (${m.replyCount})` : "Reply in thread", icon: <MessageSquareReply />, onSelect: () => ops.reply(m) }] : [];
  if (ops.guest) {
    return [
      ...reply,
      ...(mine && m.kind === "text" && !m.deleted ? [{ label: "Edit", icon: <Pencil />, onSelect: () => ops.edit(m) } as MenuItem] : []),
      { label: "Copy text", icon: <Copy />, onSelect: copy },
      ...(mine ? ["separator" as const, { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => ops.remove(m) } as MenuItem] : []),
    ];
  }
  return [
    ...reply,
    ...(mine && ["text", "decision"].includes(m.kind) && !m.deleted ? [{ label: "Edit", icon: <Pencil />, onSelect: () => ops.edit(m) } as MenuItem] : []),
    { label: m.pinned ? "Unpin" : "Pin to the conversation", icon: m.pinned ? <PinOff /> : <Pin />, onSelect: () => ops.pin(m, !m.pinned) },
    { label: m.saved ? "Remove from saved" : "Save for later", icon: m.saved ? <BookmarkCheck /> : <Bookmark />, onSelect: () => ops.save(m, !m.saved) },
    { label: "Remind me about this…", icon: <Clock3 />, onSelect: () => ops.remind(m) },
    { label: "Mark unread from here", icon: <CircleDot />, onSelect: () => ops.unread(m) },
    "separator",
    { label: "Forward…", icon: <Forward />, onSelect: () => ops.forward(m) },
    { label: "Make a task…", icon: <ListChecks />, onSelect: () => ops.task(m) },
    ...(ops.email ? [{ label: "Email this…", icon: <Mail />, onSelect: () => ops.email!(m) } as MenuItem] : []),
    { label: "Copy link", icon: <Link2 />, onSelect: () => ops.copyLink(m) },
    { label: "Copy text", icon: <Copy />, onSelect: copy },
    ...((mine || ops.admin || ops.channel.role === "owner" || ops.channel.role === "admin") ? ["separator" as const, { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => ops.remove(m) } as MenuItem] : []),
  ];
}

/** Reactions under a message; ones that arrive while you're looking pop in. */
function Reactions({ m, ops }: { m: MessageOut; ops: Ops }) {
  const [seen] = useState(() => new Map(m.reactions.map((r) => [r.emoji, r.users.length])));
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {m.reactions.map((r) => {
        const me = r.users.includes(ops.me);
        const fresh = seen.get(r.emoji) !== r.users.length;
        return (
          <button key={r.emoji} type="button" aria-pressed={me} disabled={!ops.channel.member} onClick={() => ops.react(m, r.emoji, !me)} title={r.users.map((u) => nameOf(ops, u)).join(", ")} className={cx("chat-press inline-flex h-[26px] items-center gap-1 rounded-full border px-2 text-[13px] hover:-translate-y-px", me ? "border-sky-500/50 bg-sky-500/10 shadow-[0_0_0_1px_rgba(14,165,233,0.12)]" : "border-border bg-[var(--surface-solid)] hover:border-fg/25", fresh && "chat-pop")}>
            <span>{r.emoji}</span>
            <span key={r.users.length} className={cx("text-[11.5px] font-semibold tabular-nums", me ? "text-sky-700 dark:text-sky-300" : "text-muted", fresh && "chat-pop")}>{r.users.length}</span>
          </button>
        );
      })}
      {ops.channel.member && <button type="button" aria-label="Add a reaction" onClick={(e) => ops.emojiPicker(m, e.currentTarget)} className="chat-press chat-hover-reveal grid h-[26px] w-8 place-items-center rounded-full border border-dashed border-border text-muted opacity-0 group-hover:opacity-100 hover:text-fg focus:opacity-100"><SmilePlus className="size-3.5" /></button>}
    </div>
  );
}

/** The touch action sheet: quick reactions, then everything in the ⋯ menu. */
function MessageSheet({ m, ops, inThread, onClose }: { m: MessageOut; ops: Ops; inThread: boolean; onClose: () => void }) {
  const items = actionsFor(m, ops, inThread, true);
  const canPost = ops.channel.member && !ops.channel.archived;
  const author = ops.people.get(m.authorId ?? "");
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const run = (f: () => void) => {
    onClose();
    f();
  };
  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Message actions">
      <button type="button" aria-label="Close" onClick={onClose} className="chat-fade absolute inset-0 bg-black/35" />
      <div className="chat-sheet-up absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[24px] bg-[var(--surface-solid)] px-3 pt-2 pb-[max(14px,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,0.22)]">
        <span aria-hidden className="mx-auto mb-2 block h-1 w-10 rounded-full bg-border" />
        <div className="mb-2 flex items-start gap-2.5 rounded-[14px] bg-surface-2/70 px-3 py-2.5">
          <Avatar id={m.authorId ?? ""} name={author?.name ?? "Someone"} size={28} />
          <div className="min-w-0"><p className="text-[12.5px] font-semibold">{author?.name ?? "Someone"} <span className="font-normal text-subtle">{clock(m.createdAt)}</span></p><p className="line-clamp-2 text-[13px] text-muted">{plain(m.body) || (m.files.length ? `${m.files.length} file${m.files.length === 1 ? "" : "s"}` : m.kind)}</p></div>
        </div>
        {canPost && !m.deleted && (
          <div className="mb-1 flex items-center justify-between gap-1 px-1">
            {QUICK_REACTIONS.slice(0, 6).map((e) => {
              const on = !!m.reactions.find((r) => r.emoji === e)?.users.includes(ops.me);
              return <button key={e} type="button" aria-label={`React ${e}`} onClick={() => run(() => ops.react(m, e, !on))} className={cx("chat-press grid size-11 place-items-center rounded-full text-[22px]", on ? "bg-sky-500/15" : "bg-surface-2")}>{e}</button>;
            })}
            <button type="button" aria-label="More reactions" onClick={(ev) => { const el = ev.currentTarget; onClose(); ops.emojiPicker(m, el); }} className="chat-press grid size-11 place-items-center rounded-full bg-surface-2 text-muted"><SmilePlus className="size-5" /></button>
          </div>
        )}
        <ul className="mt-1 grid">
          {items.map((it, i) =>
            it === "separator" ? <li key={i} aria-hidden className="mx-3 my-1 h-px bg-border" /> : (
              <li key={i}>
                <button type="button" disabled={it.disabled} onClick={() => run(it.onSelect)} className={cx("chat-press flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left text-[15px] active:bg-surface-2 disabled:opacity-40 [&_svg]:size-5", it.danger ? "text-red-600" : "text-fg")}>
                  <span className={cx(it.danger ? "text-red-600" : "text-muted")}>{it.icon}</span>{it.label}
                </button>
              </li>
            ),
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

type Props = { m: MessageOut; ops: Ops; compact: boolean; base: string; inThread?: boolean; highlight?: boolean; readBy?: string[]; isNew?: boolean };

export const Message = memo(function Message({ m, ops, compact, base, inThread, highlight, readBy, isNew }: Props) {
  const [hover, setHover] = useState(false);
  const [sheet, setSheet] = useState(false);
  const closeSheet = useCallback(() => setSheet(false), []);
  if (m.kind === "system") {
    return (
      <div id={`m-${m.id}`} className={cx("flex items-center justify-center gap-2 px-4 py-2 text-center text-[12px] text-muted", isNew && "chat-msg-in")}>
        <span className="h-px w-8 bg-gradient-to-r from-transparent to-border" />
        <span className="max-w-[80%] rounded-full bg-surface-2/70 px-3 py-0.5"><RichText body={m.body} ops={ops} /></span>
        <span className="shrink-0 text-[11px] text-subtle tabular-nums">{clock(m.createdAt)}</span>
        <span className="h-px w-8 bg-gradient-to-l from-transparent to-border" />
      </div>
    );
  }
  const author = ops.people.get(m.authorId ?? "");
  const mine = m.authorId === ops.me;
  const mentionsMe = m.mentions.users.includes(ops.me) || m.mentions.everyone;
  const canPost = ops.channel.member && !ops.channel.archived;
  const actionable = !m.deleted && !m.scheduledFor;
  return (
    <div
      id={`m-${m.id}`}
      onMouseEnter={() => canHover() && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => canHover() && setHover(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHover(false)}
      onClick={(e) => {
        // On touch screens a tap anywhere but a control opens the actions.
        if (canHover() || !actionable || (e.target as HTMLElement).closest(INTERACTIVE) || window.getSelection()?.toString()) return;
        e.stopPropagation();
        setSheet(true);
      }}
      onContextMenu={(e) => {
        if (canHover() || !actionable) return;
        e.preventDefault();
        setSheet(true);
      }}
      className={cx(
        "group relative mx-1.5 flex gap-3 rounded-[14px] px-2.5 transition-colors duration-150 @2xl/chat:mx-2 @2xl/chat:px-3",
        compact ? "py-0.5" : "mt-1 pt-2 pb-1",
        highlight ? "chat-flash" : m.priority === "urgent" ? "bg-red-500/[0.05]" : mentionsMe && !mine ? "bg-amber-100/45 dark:bg-amber-400/[0.06]" : "hover:bg-surface-2/70",
        hover && !highlight && "bg-surface-2/70",
        isNew && "chat-msg-in",
      )}
    >
      {(m.priority !== "normal" || (mentionsMe && !mine)) && <span aria-hidden className={cx("absolute inset-y-1.5 left-0 w-[3px] rounded-full", m.priority === "urgent" ? "bg-red-500" : m.priority === "important" ? "bg-amber-500" : "bg-amber-400")} />}
      <div className="chat-row-body flex min-w-0 flex-1 gap-3">
        <div className="w-9 shrink-0">
          {compact ? <span className="-ml-1 hidden pt-[3px] text-[10px] whitespace-nowrap text-subtle tabular-nums group-hover:block">{clock(m.createdAt).replace(/\s?[ap]m$/i, "")}</span> : <Avatar id={m.authorId ?? ""} name={author?.name ?? "Someone"} person={author} size={36} />}
        </div>
        <div className="min-w-0 flex-1">
          {!compact && (
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[14px] font-semibold tracking-[-0.005em]">{author?.name ?? "Former member"}</span>
              {author?.guest && <span title="Not in the workspace — joined with an invite link" className="self-center rounded-full bg-teal-500/12 px-1.5 py-px text-[10.5px] font-semibold text-teal-700 dark:text-teal-300">Guest</span>}
              <time dateTime={m.createdAt} title={longWhen(m.createdAt)} className="text-[11.5px] text-subtle tabular-nums">{clock(m.createdAt)}</time>
              {m.priority === "urgent" && <span className="inline-flex items-center gap-1 self-center rounded-full bg-red-600 px-2 py-px text-[10.5px] font-bold tracking-wide text-white uppercase"><TriangleAlert className="size-3" />Urgent</span>}
              {m.priority === "important" && <span className="self-center rounded-full bg-amber-500/15 px-2 py-px text-[10.5px] font-bold tracking-wide text-amber-700 uppercase dark:text-amber-300">Important</span>}
            </p>
          )}
          {m.scheduledFor && <p className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11.5px] font-medium text-sky-700 dark:text-sky-300"><Clock3 className="size-3" />Scheduled for {longWhen(m.scheduledFor)} — only you can see it</p>}
          {m.forwardedFrom && <p className="mb-0.5 inline-flex items-center gap-1 text-[11.5px] text-muted"><CornerUpRight className="size-3" />Forwarded from {m.forwardedFrom.channel}{m.forwardedFrom.author ? ` · ${nameOf(ops, m.forwardedFrom.author)}` : ""}</p>}
          {m.pinned && !inThread && <p className="mb-0.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-amber-700 dark:text-amber-400"><Pin className="size-3" />Pinned</p>}
          {m.deleted ? (
            <p className="text-[13.5px] text-subtle italic">This message was deleted.</p>
          ) : (
            <>
              {m.body && <RichText body={m.body} ops={ops} records={m.mentions.records} />}
              {m.editedAt && <span className="text-[11px] text-subtle" title={`Edited ${longWhen(m.editedAt)}`}> (edited)</span>}
              {m.kind === "poll" && <Poll m={m} ops={ops} />}
              {m.kind === "checklist" && <Checklist m={m} ops={ops} />}
              {m.kind === "decision" && <Decision m={m} ops={ops} />}
              {m.kind === "approval" && <Approval m={m} ops={ops} />}
              {m.kind === "record" && <RecordCard m={m} />}
              {m.kind === "call" && <CallCard m={m} ops={ops} />}
              {m.kind === "event" && <EventCard m={m} ops={ops} />}
              <Files m={m} base={base} />
            </>
          )}
          {m.reactions.length > 0 && <Reactions m={m} ops={ops} />}
          {!inThread && m.replyCount > 0 && (
            <button type="button" onClick={() => ops.reply(m)} className="chat-press group/rep mt-1 -ml-1.5 flex items-center gap-2 rounded-[10px] border border-transparent px-1.5 py-1 text-[12.5px] hover:border-border hover:bg-[var(--surface-solid)]">
              <Faces ids={m.replyPeople} ops={ops} max={4} />
              <span className="font-semibold text-sky-700 dark:text-sky-400">{m.replyCount} {m.replyCount === 1 ? "reply" : "replies"}</span>
              {m.lastReplyAt && <span className="text-muted">Last {shortWhen(m.lastReplyAt)}</span>}
              <span className="text-subtle opacity-0 transition-opacity group-hover/rep:opacity-100">View thread →</span>
            </button>
          )}
          {readBy && readBy.length > 0 && <p className="chat-fade mt-0.5 flex items-center justify-end gap-1 text-[11px] text-subtle">Seen by <Faces ids={readBy} ops={ops} max={6} /></p>}
        </div>
      </div>
      {hover && actionable && (
        <div className="chat-toolbar-in chat-glass absolute -top-4 right-3 z-10 flex items-center gap-px rounded-[12px] border border-border p-0.5 shadow-[0_6px_20px_-6px_rgba(0,0,0,0.25)]">
          {canPost && QUICK_REACTIONS.slice(0, 4).map((e) => (
            <button key={e} type="button" aria-label={`React ${e}`} onClick={() => ops.react(m, e, !m.reactions.find((r) => r.emoji === e)?.users.includes(ops.me))} className="chat-press grid size-7 place-items-center rounded-[9px] text-[15px] hover:scale-110 hover:bg-surface-2">{e}</button>
          ))}
          {canPost && <button type="button" aria-label="More reactions" onClick={(e) => ops.emojiPicker(m, e.currentTarget)} className="chat-press grid size-7 place-items-center rounded-[9px] text-muted hover:bg-surface-2 hover:text-fg"><SmilePlus className="size-4" /></button>}
          {canPost && <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />}
          {!inThread && canPost && <button type="button" aria-label="Reply in thread" title="Reply in thread" onClick={() => ops.reply(m)} className="chat-press grid size-7 place-items-center rounded-[9px] text-muted hover:bg-surface-2 hover:text-fg"><MessageSquareReply className="size-4" /></button>}
          {!ops.guest && <button type="button" aria-label={m.saved ? "Saved" : "Save for later"} title={m.saved ? "Saved" : "Save for later"} onClick={() => ops.save(m, !m.saved)} className={cx("chat-press grid size-7 place-items-center rounded-[9px] hover:bg-surface-2", m.saved ? "text-amber-600" : "text-muted hover:text-fg")}>{m.saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}</button>}
          <Menu label="Message actions" trigger={(p) => <button {...p} type="button" aria-label="More actions" className="chat-press grid size-7 place-items-center rounded-[9px] text-muted hover:bg-surface-2 hover:text-fg"><MoreHorizontal className="size-4" /></button>} items={actionsFor(m, ops, !!inThread, false)} />
        </div>
      )}
      {sheet && <MessageSheet m={m} ops={ops} inThread={!!inThread} onClose={closeSheet} />}
    </div>
  );
});
