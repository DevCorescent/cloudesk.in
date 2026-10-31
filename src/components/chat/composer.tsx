"use client";

// Writing a message. Type @ for people, # for any record in Cloudesk (or a
// #topic), / for commands; format with the toolbar or **, _, `; attach files;
// mark it important or urgent; schedule it; let AI polish or translate it.
// While you type, people and records show as @Name and #Label — they become
// exact references when it's sent.
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Bold, CalendarClock, CalendarPlus, Code2, FileUp, Gavel, Italic, Link2, List, ListChecks, ListOrdered, Loader2, Paperclip, Plus, Quote, Send, ShieldCheck, Smile, Sparkles, SquareCode, Strikethrough, TriangleAlert, Video, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { Dialog, Menu, useToast } from "@/components/ui/overlays";
import { Button, Input, cx } from "@/components/ui/primitives";
import { useShortcuts } from "@/components/ui/shortcut";
import { api, errorMessage } from "@/lib/client/api";
import type { ChannelOut, MetaOut, PersonOut } from "@/lib/chat/api";
import { COMMANDS, MAX_FILE, pipeParts, type PostIn } from "@/lib/chat/model";
import { recordToken, userToken } from "@/lib/chat/text";
import { Avatar, fileSize, presenceOf, useChatApi } from "./shared";

// ── Emoji ───────────────────────────────────────────────────────────────────

const EMOJI: [string, string][] = [
  ["👍", "thumbs up yes ok"], ["👎", "thumbs down no"], ["❤️", "heart love"], ["😂", "laugh joy"], ["🎉", "party celebrate tada"], ["🙏", "thanks please pray"], ["👀", "eyes looking"], ["✅", "done check yes"],
  ["🔥", "fire hot"], ["💯", "hundred perfect"], ["👏", "clap applause"], ["🙌", "hooray raise"], ["😊", "smile happy"], ["😄", "grin happy"], ["😅", "sweat relief"], ["🤔", "thinking hmm"],
  ["😮", "wow surprised"], ["😢", "sad cry"], ["😡", "angry"], ["🤝", "deal handshake agree"], ["💪", "strong muscle"], ["🚀", "rocket launch ship"], ["⭐", "star"], ["✨", "sparkles new"],
  ["⚠️", "warning careful"], ["❌", "no wrong cross"], ["❓", "question"], ["❗", "important exclamation"], ["⏰", "alarm time late"], ["📅", "calendar date meeting"], ["📌", "pin"], ["📎", "attachment clip"],
  ["📈", "growth up chart"], ["📉", "down chart"], ["💰", "money"], ["₹", "rupee"], ["🧾", "invoice receipt bill"], ["📦", "package order stock"], ["🚚", "delivery truck shipping"], ["🛒", "cart shop"],
  ["☕", "coffee break"], ["🍕", "pizza lunch"], ["🎂", "birthday cake"], ["🏆", "trophy win"], ["🎯", "target goal"], ["💡", "idea"], ["🛠️", "tools fix"], ["🐞", "bug"],
  ["👋", "wave hello hi bye"], ["🤞", "fingers crossed luck"], ["👌", "ok perfect"], ["🙂", "slight smile"], ["😎", "cool"], ["🥳", "party"], ["😴", "sleep tired"], ["🤯", "mind blown"],
  ["💬", "chat talk"], ["📞", "call phone"], ["📧", "email mail"], ["🗂️", "files folder"], ["🔒", "lock private"], ["🔗", "link"], ["🟢", "green go"], ["🔴", "red stop"],
];

export function EmojiPicker({ onPick, onClose, anchor }: { onPick: (e: string) => void; onClose: () => void; anchor: DOMRect | null }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", down), 0);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const list = EMOJI.filter(([e, n]) => !q || n.includes(q.toLowerCase()) || e === q);
  const top = anchor ? Math.max(8, Math.min(anchor.top - 300, window.innerHeight - 320)) : 80;
  const left = anchor ? Math.max(8, Math.min(anchor.left - 140, window.innerWidth - 300)) : 80;
  return (
    <div ref={ref} role="dialog" aria-label="Emoji" className="chat-toolbar-in fixed z-[80] w-[288px] rounded-[18px] border border-border bg-[var(--surface-solid)] p-2 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.35)]" style={{ top, left }}>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search emoji" aria-label="Search emoji" className="mb-2 h-8" />
      <div className="grid max-h-[220px] grid-cols-8 gap-0.5 overflow-y-auto">
        {list.map(([e, n]) => <button key={e} type="button" title={n.split(" ")[0]} onClick={() => onPick(e)} className="chat-press grid size-8 place-items-center rounded-[8px] text-[19px] transition-transform hover:scale-125 hover:bg-surface-2">{e}</button>)}
        {!list.length && <p className="col-span-8 py-6 text-center text-[12.5px] text-muted">No match</p>}
      </div>
    </div>
  );
}

// ── Suggestions ─────────────────────────────────────────────────────────────

type Hit = { kind: string; id: string; label: string; sub: string; link: string };
type Sug =
  | { t: "person"; p: PersonOut }
  | { t: "everyone"; v: "everyone" | "here" }
  | { t: "record"; h: Hit }
  | { t: "tag"; v: string }
  | { t: "cmd"; c: (typeof COMMANDS)[number] };

const KIND: Record<string, string> = { contacts: "Contact", deals: "Deal", suppliers: "Supplier", items: "Item", employees: "Person", projects: "Project", invoices: "Invoice", tickets: "Ticket", orders: "Sales order", students: "Student", patients: "Patient", contracts: "Contract", records: "Record", webapps: "Web app" };

function trigger(text: string, caret: number): { ch: "@" | "#" | "/"; q: string; start: number } | null {
  const before = text.slice(0, caret);
  const slash = /^\/(\w*)$/.exec(before);
  if (slash) return { ch: "/", q: slash[1]!, start: 0 };
  const m = /(^|[\s(])([@#])([^\s@#]{0,40}(?: [^\s@#]{0,20})?)$/.exec(before);
  if (!m) return null;
  // "@Ravi K" may span one space; stop at two words.
  return { ch: m[2] as "@" | "#", q: m[3]!, start: before.length - m[3]!.length - 1 };
}

export type ComposerHandle = { focus: () => void; insert: (s: string) => void; setText: (s: string) => void };
export type Built = { body: string; records: { kind: string; id: string; label: string; link: string }[] };

type Props = {
  channel: ChannelOut;
  meta: MetaOut;
  people: Map<string, PersonOut>;
  placeholder: string;
  thread?: string | null;
  draftKey: string;
  initial?: { text: string; refs: Record<string, string>; links: Record<string, string> };
  editing?: boolean;
  onSend: (p: PostIn) => Promise<boolean>;
  onCancel?: () => void;
  onEditLast?: () => void;
  onOpen: (what: "poll" | "checklist" | "decision" | "approval" | "meeting" | "task" | "summary", init?: string) => void;
  onStatus: (status: string, note: string) => void;
  onRemind: (when: string) => void;
  extra?: ReactNode;
};

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ channel, meta, people, placeholder, thread = null, draftKey, initial, editing, onSend, onCancel, onEditLast, onOpen, onStatus, onRemind, extra }, handle) {
  const { org } = useSession();
  const { call, base } = useChatApi();
  const toast = useToast();
  const ta = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => {
    if (initial) return initial.text;
    try {
      return localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  // "@Ravi Kumar" → token, "#INV/0042" → token (and its link).
  const refs = useRef<Record<string, string>>(initial?.refs ?? {});
  const links = useRef<Record<string, string>>(initial?.links ?? {});
  const [caret, setCaret] = useState(0);
  const [hi, setHi] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [files, setFiles] = useState<{ key: string; id?: string; filename: string; size: number; error?: string }[]>([]);
  const [priority, setPriority] = useState<"normal" | "important" | "urgent">("normal");
  const [schedule, setSchedule] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [emoji, setEmoji] = useState<DOMRect | null>(null);
  const [sending, setSending] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [linkDlg, setLinkDlg] = useState(false);
  const typed = useRef(0);

  const { withKeys, keys } = useShortcuts();
  const newLine = keys("shift+enter");
  useImperativeHandle(handle, () => ({ focus: () => ta.current?.focus(), insert: (s) => insertAt(s), setText: (s) => setText(s) }));

  // Draft per conversation (not when editing).
  useEffect(() => {
    if (editing) return;
    const t = setTimeout(() => {
      try {
        if (text) localStorage.setItem(draftKey, text);
        else localStorage.removeItem(draftKey);
      } catch {
        /* private mode */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [text, draftKey, editing]);

  // Editing starts with the cursor at the end of the message, so typing (or Escape) works straight away.
  useEffect(() => {
    const el = ta.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // Grow with the text, up to a point.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  const trig = useMemo(() => (dismissed === caret ? null : trigger(text, caret)), [text, caret, dismissed]);
  const q = trig?.q ?? "";
  const records = useQuery({
    queryKey: ["chat-records", org.id, q],
    queryFn: () => api<{ results: Hit[] }>(`/api/v1/orgs/${org.id}/search?q=${encodeURIComponent(q)}`),
    enabled: trig?.ch === "#" && q.length >= 2,
    staleTime: 30_000,
  });
  const sugs: Sug[] = useMemo(() => {
    if (!trig) return [];
    const lq = q.toLowerCase();
    if (trig.ch === "/") return COMMANDS.filter((c) => c.cmd.startsWith(lq)).map((c) => ({ t: "cmd", c }));
    if (trig.ch === "@") {
      const ppl = [...people.values()].filter((p) => p.id !== meta.me.id && (`${p.name} ${p.email}`.toLowerCase().includes(lq) || p.name.toLowerCase().split(" ").some((w) => w.startsWith(lq))));
      // People in this conversation first.
      const inHere = new Set(channel.kind === "channel" ? [] : channel.people);
      ppl.sort((a, b) => Number(inHere.has(b.id)) - Number(inHere.has(a.id)) || a.name.localeCompare(b.name));
      const ev: Sug[] = channel.kind !== "dm" ? (["everyone", "here"] as const).filter((v) => v.startsWith(lq)).map((v) => ({ t: "everyone", v })) : [];
      return [...ppl.slice(0, 8).map((p) => ({ t: "person", p }) as Sug), ...ev];
    }
    const out: Sug[] = (records.data?.results ?? []).slice(0, 8).map((h) => ({ t: "record", h }));
    if (/^[a-z][\w-]{1,39}$/i.test(q)) out.push({ t: "tag", v: q.toLowerCase() });
    return out;
  }, [trig, q, people, meta.me.id, channel, records.data]);

  const replaceTrigger = (insert: string) => {
    if (!trig) return;
    const next = text.slice(0, trig.start) + insert + text.slice(caret);
    setText(next);
    const pos = trig.start + insert.length;
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };
  const insertAt = (s: string) => {
    const el = ta.current;
    const a = el?.selectionStart ?? text.length;
    const b = el?.selectionEnd ?? text.length;
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + s.length, a + s.length);
      setCaret(a + s.length);
    });
  };
  const pick = (s: Sug) => {
    setHi(0);
    if (s.t === "person") {
      const display = `@${s.p.name}`;
      refs.current[display] = userToken(s.p.id, s.p.name);
      replaceTrigger(`${display} `);
    } else if (s.t === "everyone") replaceTrigger(`@${s.v} `);
    else if (s.t === "record") {
      const label = s.h.label.split(" · ")[0]!.slice(0, 100);
      const display = `#${label}`;
      refs.current[display] = recordToken(s.h.kind, s.h.id, label);
      links.current[`${s.h.kind}/${s.h.id}`] = s.h.link;
      replaceTrigger(`${display} `);
    } else if (s.t === "tag") replaceTrigger(`#${s.v} `);
    else replaceTrigger(`/${s.c.cmd} `);
  };

  /** The text with @Name / #Label turned back into exact references. */
  const build = useCallback((raw: string): Built => {
    let body = raw;
    const keys = Object.keys(refs.current).filter((k) => body.includes(k)).sort((a, b) => b.length - a.length);
    // Placeholders first, so a longer name never gets half-replaced by a shorter one.
    keys.forEach((k, i) => (body = body.split(k).join(`\u0000${i}\u0000`)));
    keys.forEach((k, i) => (body = body.split(`\u0000${i}\u0000`).join(refs.current[k]!)));
    const recs = [...body.matchAll(/#\[([^\]\n]{1,120})\]\(r:([a-z0-9_-]{1,40})\/([\w-]{1,80})\)/g)].map((m) => ({ kind: m[2]!, id: m[3]!, label: m[1]!, link: links.current[`${m[2]}/${m[3]}`] ?? "" }));
    return { body, records: recs };
  }, []);

  const typingPing = () => {
    if (editing || Date.now() - typed.current < 3000) return;
    typed.current = Date.now();
    void call(`channels/${channel.id}/typing`, "POST", { thread }).catch(() => {});
  };

  const upload = async (list: FileList | File[]) => {
    for (const f of Array.from(list).slice(0, 10)) {
      const key = `${f.name}-${f.size}-${Math.random()}`;
      if (f.size > MAX_FILE) {
        toast({ tone: "error", title: `${f.name} is over 25 MB` });
        continue;
      }
      setFiles((x) => [...x, { key, filename: f.name, size: f.size }]);
      try {
        const res = await fetch(`${base}/channels/${channel.id}/files?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f, headers: { "Content-Type": f.type || "application/octet-stream" }, credentials: "same-origin" });
        const j = (await res.json()) as { file?: { id: string }; error?: { message: string } };
        if (!res.ok || !j.file) throw new Error(j.error?.message ?? "Upload failed");
        setFiles((x) => x.map((y) => (y.key === key ? { ...y, id: j.file!.id } : y)));
      } catch (e) {
        setFiles((x) => x.map((y) => (y.key === key ? { ...y, error: (e as Error).message } : y)));
      }
    }
  };

  /** Slash commands: some post straight away, others open their builder. */
  const command = async (raw: string): Promise<boolean> => {
    const m = /^\/(\w+)\s*([\s\S]*)$/.exec(raw.trim());
    if (!m) return false;
    const [, cmd, arg = ""] = m;
    const parts = pipeParts(arg);
    switch (cmd) {
      case "poll":
        if (parts.length >= 3) return onSend({ poll: { question: parts[0]!, options: parts.slice(1, 13).map((label, i) => ({ id: `o${i + 1}`, label })) } });
        onOpen("poll", arg);
        return true;
      case "checklist":
        if (parts.length >= 2) return onSend({ checklist: { title: parts[0]!, items: parts.slice(1, 41).map((label, i) => ({ id: `i${i + 1}`, label })) } });
        onOpen("checklist", arg);
        return true;
      case "decide":
        if (arg.trim()) return onSend({ decision: { text: arg.trim() } });
        onOpen("decision");
        return true;
      case "approve":
        onOpen("approval", arg.trim());
        return true;
      case "task":
        onOpen("task", arg.trim());
        return true;
      case "call":
        return onSend({ call: { title: arg.trim() } });
      case "meet":
        onOpen("meeting", arg.trim());
        return true;
      case "remind":
        onRemind(arg.trim() || "in 1h");
        return true;
      case "status": {
        const [st = "available", ...rest] = arg.trim().split(/\s+/);
        onStatus(st, rest.join(" "));
        return true;
      }
      case "summary":
        onOpen("summary");
        return true;
      case "shrug":
        return onSend({ body: `${arg.trim()} ¯\\\\_(ツ)_/¯`.trim() });
    }
    return false;
  };

  const send = async () => {
    if (sending) return;
    const raw = text.trim();
    const ready = files.filter((f) => f.id);
    if (files.some((f) => !f.id && !f.error)) return toast({ tone: "info", title: "Still uploading — one moment" });
    if (!raw && !ready.length) return;
    setSending(true);
    try {
      if (!editing && raw.startsWith("/") && !raw.startsWith("//")) {
        const handled = await command(raw);
        if (handled) {
          setText("");
          return;
        }
      }
      const b = build(raw);
      const ok = await onSend({ body: b.body, records: b.records, files: ready.map((f) => f.id!), priority, scheduledFor: schedule, parentId: thread });
      if (ok) {
        setText("");
        setFiles([]);
        setPriority("normal");
        setSchedule(null);
        refs.current = {};
      }
    } finally {
      setSending(false);
    }
  };

  const wrap = (a: string, b = a) => {
    const el = ta.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const sel = text.slice(s, e) || "text";
    setText(text.slice(0, s) + a + sel + b + text.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + a.length, s + a.length + sel.length);
    });
  };
  const linePrefix = (p: string) => {
    const el = ta.current;
    if (!el) return;
    const s = text.lastIndexOf("\n", el.selectionStart - 1) + 1;
    setText(text.slice(0, s) + p + text.slice(s));
    requestAnimationFrame(() => el.focus());
  };

  const rewrite = async (how: string, language?: string) => {
    if (!text.trim()) return toast({ tone: "info", title: "Write something first" });
    setRewriting(true);
    try {
      const r = await call<{ text: string }>("ai/rewrite", "POST", { text: build(text).body, how, language });
      // Tokens come back; show them as names again.
      let t = r.text;
      for (const [display, token] of Object.entries(refs.current)) t = t.split(token).join(display);
      setText(t);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setRewriting(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sugs.length && trig) {
      if (e.key === "ArrowDown") return void (e.preventDefault(), setHi((h) => (h + 1) % sugs.length));
      if (e.key === "ArrowUp") return void (e.preventDefault(), setHi((h) => (h - 1 + sugs.length) % sugs.length));
      if (e.key === "Enter" || e.key === "Tab") return void (e.preventDefault(), pick(sugs[Math.min(hi, sugs.length - 1)]!));
      if (e.key === "Escape") return void (e.preventDefault(), setDismissed(caret));
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") return void (e.preventDefault(), wrap("**"));
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") return void (e.preventDefault(), wrap("_"));
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "x") return void (e.preventDefault(), wrap("~~"));
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") return void (e.preventDefault(), wrap("`"));
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      // Inside a code block, Enter is a new line.
      const open = (text.slice(0, caret).match(/```/g) ?? []).length % 2 === 1;
      if (!open) return void (e.preventDefault(), void send());
    }
    if (e.key === "Escape" && editing) return void onCancel?.();
    if (e.key === "ArrowUp" && !text && onEditLast) return void (e.preventDefault(), onEditLast());
  };

  const disabled = !channel.member || channel.archived || (channel.posting === "admins" && channel.role === "member" && !meta.me.admin);
  if (disabled && !editing) {
    return (
      <div className="m-3 rounded-[16px] border border-dashed border-border px-4 py-3 text-center text-[13px] text-muted">
        {channel.archived ? "This channel is archived — read only." : !channel.member ? "Join the channel to write here." : "Only the channel's admins post here."}
      </div>
    );
  }

  const tool = (label: string, icon: ReactNode, on: () => void, keys?: string) => (
    <button type="button" aria-label={label} title={keys ? withKeys(label, keys) : label} onMouseDown={(e) => e.preventDefault()} onClick={on} className="chat-press grid size-7 shrink-0 place-items-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-fg [&>svg]:size-[15px]">{icon}</button>
  );

  return (
    <div className={cx("relative", !editing && "px-3 pb-3 @2xl/chat:px-4")}>
      {trig && sugs.length > 0 && (
        <ul role="listbox" aria-label="Suggestions" className="chat-toolbar-in absolute right-3 bottom-full left-3 z-30 mb-1.5 max-h-72 overflow-y-auto rounded-[14px] border border-border bg-[var(--surface-solid)] p-1.5 shadow-2xl @2xl/chat:right-auto @2xl/chat:w-[420px]">
          <li className="px-2 pt-0.5 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">{trig.ch === "@" ? "People" : trig.ch === "/" ? "Commands" : "Records and topics"}</li>
          {sugs.map((s, i) => (
            <li key={i} role="option" aria-selected={i === hi}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setHi(i)} className={cx("flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left", i === hi && "bg-surface-2")}>
                {s.t === "person" ? (
                  <>
                    <Avatar id={s.p.id} name={s.p.name} person={s.p} size={26} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{s.p.name}</span><span className="block truncate text-[11.5px] text-muted">{presenceOf(s.p).label}{s.p.note ? ` · ${s.p.emoji} ${s.p.note}` : ""}</span></span>
                    {channel.kind === "channel" && channel.visibility === "private" && <span className="text-[10.5px] text-subtle">{s.p.email}</span>}
                  </>
                ) : s.t === "everyone" ? (
                  <><span className="grid size-[26px] place-items-center rounded-full bg-amber-500/15 text-[13px]">📣</span><span className="flex-1 text-[13.5px] font-medium">@{s.v}</span><span className="text-[11.5px] text-muted">{s.v === "everyone" ? "Everyone in this conversation" : "Everyone, same thing"}</span></>
                ) : s.t === "record" ? (
                  <><span className="grid size-[26px] place-items-center rounded-[8px] bg-violet-500/12 text-violet-600"><Link2 className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{s.h.label}</span><span className="block truncate text-[11.5px] text-muted">{KIND[s.h.kind] ?? s.h.kind}{s.h.sub ? ` · ${s.h.sub}` : ""}</span></span></>
                ) : s.t === "tag" ? (
                  <><span className="grid size-[26px] place-items-center rounded-[8px] bg-surface-2 text-[13px] font-bold text-violet-600">#</span><span className="flex-1 text-[13.5px]">Topic <b className="font-semibold">#{s.v}</b></span></>
                ) : (
                  <><span className="grid size-[26px] place-items-center rounded-[8px] bg-surface-2 font-mono text-[12px] text-muted">/</span><span className="min-w-0 flex-1"><span className="block text-[13.5px] font-medium">/{s.c.cmd} <span className="font-normal text-subtle">{s.c.hint}</span></span><span className="block text-[11.5px] text-muted">{s.c.label}</span></span></>
                )}
              </button>
            </li>
          ))}
          {trig.ch === "#" && records.isFetching && <li className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-muted"><Loader2 className="size-3 animate-spin" />Searching Cloudesk…</li>}
        </ul>
      )}
      <div
        className={cx("chat-composer rounded-[20px] border bg-[var(--surface-solid)]", priority === "urgent" ? "border-red-500/60" : priority === "important" ? "border-amber-500/60" : "border-border focus-within:border-sky-500/50")}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
      >
        {(priority !== "normal" || schedule) && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
            {priority !== "normal" && <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold", priority === "urgent" ? "bg-red-600 text-white" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}><TriangleAlert className="size-3" />{priority === "urgent" ? "Urgent — notifies every 2 minutes for 20 minutes until read" : "Important"}<button type="button" aria-label="Clear" onClick={() => setPriority("normal")}><X className="size-3" /></button></span>}
            {schedule && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11.5px] font-semibold text-sky-700 dark:text-sky-300"><CalendarClock className="size-3" />Sends {new Date(schedule).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}<button type="button" aria-label="Clear" onClick={() => setSchedule(null)}><X className="size-3" /></button></span>}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          aria-label="Message"
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setDismissed(null);
            typingPing();
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              void upload(e.clipboardData.files);
            }
          }}
          style={{ outline: "none" }}
          className="block max-h-[260px] min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-[14px] leading-[1.5] placeholder:text-subtle"
        />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-1.5">
            {files.map((f) => (
              <span key={f.key} className={cx("inline-flex max-w-[240px] items-center gap-1.5 rounded-[10px] border px-2 py-1 text-[12px]", f.error ? "border-red-500/40 bg-red-500/5 text-red-700" : "border-border bg-surface-2/60")}>
                {!f.id && !f.error ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Paperclip className="size-3.5 shrink-0" />}
                <span className="truncate">{f.filename}</span>
                <span className="shrink-0 text-subtle">{f.error ? f.error : fileSize(f.size)}</span>
                <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => setFiles((x) => x.filter((y) => y.key !== f.key))}><X className="size-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          {!editing && (
            <Menu
              label="Add"
              trigger={(p) => <button {...p} type="button" aria-label="Add a poll, checklist, call…" title="Polls, checklists, decisions, approvals, calls, meetings" className="chat-press grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg transition-transform hover:rotate-90 hover:bg-surface-3 aria-expanded:rotate-45"><Plus className="size-4" /></button>}
              items={[
                { label: "Poll", icon: <BarChart3 />, onSelect: () => onOpen("poll") },
                { label: "Shared checklist", icon: <ListChecks />, onSelect: () => onOpen("checklist") },
                { label: "Propose a decision", icon: <Gavel />, onSelect: () => onOpen("decision") },
                { label: "Ask for approval", icon: <ShieldCheck />, onSelect: () => onOpen("approval") },
                "separator",
                { label: "Start a video call now", icon: <Video />, onSelect: () => void onSend({ call: { title: "" } }) },
                { label: "Schedule a meeting", icon: <CalendarPlus />, onSelect: () => onOpen("meeting") },
                { label: "Make a task", icon: <ListChecks />, onSelect: () => onOpen("task", text) },
              ]}
            />
          )}
          <span className="mx-1 h-4 w-px bg-border" />
          <span className="hidden items-center gap-0.5 @md/chat:flex">
            {tool("Bold", <Bold />, () => wrap("**"), "mod+b")}
            {tool("Italic", <Italic />, () => wrap("_"), "mod+i")}
            {tool("Strikethrough", <Strikethrough />, () => wrap("~~"), "mod+shift+x")}
            {tool("Code", <Code2 />, () => wrap("`"), "mod+e")}
            {tool("Code block", <SquareCode />, () => wrap("```\n", "\n```"))}
            {tool("Quote", <Quote />, () => linePrefix("> "))}
            {tool("Bulleted list", <List />, () => linePrefix("- "))}
            {tool("Numbered list", <ListOrdered />, () => linePrefix("1. "))}
            {tool("Link", <Link2 />, () => setLinkDlg(true))}
            <span className="mx-1 h-4 w-px bg-border" />
          </span>
          {tool("Emoji", <Smile />, () => setEmoji((ta.current?.getBoundingClientRect() ?? null)))}
          {!editing && (
            <label title="Attach files (or paste / drop them)" className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-fg">
              <FileUp className="size-[15px]" />
              <input type="file" multiple className="sr-only" aria-label="Attach files" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
            </label>
          )}
          {!editing && (
            <Menu
              label="Priority"
              trigger={(p) => <button {...p} type="button" aria-label="Priority" title="Priority" className={cx("grid size-7 shrink-0 place-items-center rounded-[8px] hover:bg-surface-2", priority === "urgent" ? "text-red-600" : priority === "important" ? "text-amber-600" : "text-muted hover:text-fg")}><TriangleAlert className="size-[15px]" /></button>}
              items={[
                { label: "Standard", onSelect: () => setPriority("normal") },
                { label: "Important", icon: <TriangleAlert className="text-amber-600" />, onSelect: () => setPriority("important") },
                { label: "Urgent — re-notify until read", icon: <TriangleAlert className="text-red-600" />, onSelect: () => setPriority("urgent") },
              ]}
            />
          )}
          {meta.ai && channel.ai && (
            <Menu
              label="AI"
              trigger={(p) => <button {...p} type="button" aria-label="Improve with AI" title="Improve with AI" disabled={rewriting} className="grid size-7 shrink-0 place-items-center rounded-[8px] text-violet-600 hover:bg-violet-500/10">{rewriting ? <Loader2 className="size-[15px] animate-spin" /> : <Sparkles className="size-[15px]" />}</button>}
              items={[
                { label: "Polish (grammar & clarity)", onSelect: () => void rewrite("polish") },
                { label: "Make it shorter", onSelect: () => void rewrite("shorter") },
                { label: "Make it friendlier", onSelect: () => void rewrite("friendlier") },
                { label: "Make it more formal", onSelect: () => void rewrite("formal") },
                { label: "Turn into bullet points", onSelect: () => void rewrite("bullets") },
                "separator",
                { label: "Translate to English", onSelect: () => void rewrite("translate", "English") },
                { label: "Translate to Hindi", onSelect: () => void rewrite("translate", "Hindi") },
              ]}
            />
          )}
          {extra}
          <span className="ml-auto flex items-center gap-1">
            {editing ? (
              <>
                <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button size="sm" variant="primary" loading={sending} onClick={() => void send()}>Save</Button>
              </>
            ) : (
              <>
                {newLine && <span className="hidden text-[11px] whitespace-nowrap text-subtle @3xl/chat:inline">{newLine} new line</span>}
                <span className={cx("flex overflow-hidden rounded-full transition-[box-shadow,transform] duration-200", (text.trim() || files.some((f) => f.id)) && "shadow-[0_6px_16px_-6px_rgba(0,0,0,0.45)]")}>
                  <button type="button" aria-label={schedule ? "Schedule" : "Send"} disabled={sending || (!text.trim() && !files.some((f) => f.id))} onClick={() => void send()} className="chat-press grid h-8 w-9 place-items-center bg-fg text-bg transition-opacity disabled:opacity-35">{sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</button>
                  <button type="button" aria-label="Schedule send" title="Schedule send" onClick={() => setScheduling(true)} className="chat-press grid h-8 w-7 place-items-center border-l border-bg/20 bg-fg text-bg"><CalendarClock className="size-3.5" /></button>
                </span>
              </>
            )}
          </span>
        </div>
      </div>
      {emoji && <EmojiPicker anchor={emoji} onClose={() => setEmoji(null)} onPick={(e) => { insertAt(e); setEmoji(null); }} />}
      {scheduling && <ScheduleDialog onClose={() => setScheduling(false)} onPick={(d) => { setSchedule(d); setScheduling(false); }} />}
      {linkDlg && <LinkDialog onClose={() => setLinkDlg(false)} onPick={(label, url) => { insertAt(`[${label || url}](${url})`); setLinkDlg(false); }} />}
    </div>
  );
});

function ScheduleDialog({ onClose, onPick }: { onClose: () => void; onPick: (iso: string) => void }) {
  const [now] = useState(() => Date.now());
  const at = (h: number, addDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + addDays);
    d.setHours(h, 0, 0, 0);
    if (d.getTime() < now + 60_000) d.setDate(d.getDate() + 1);
    return d;
  };
  const monday = (() => {
    const d = at(9);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return d;
  })();
  const [custom, setCustom] = useState("");
  const quick: [string, Date][] = [["Tomorrow at 9:00 am", at(9, 1)], ["Today at 5:00 pm", at(17)], ["Monday at 9:00 am", monday]];
  return (
    <Dialog open onClose={onClose} size="sm" title="Schedule send" description="It posts at that time; until then only you can see it (and edit or delete it).">
      <div className="grid gap-1.5">
        {quick.map(([l, d]) => <button key={l} type="button" onClick={() => onPick(d.toISOString())} className="flex justify-between rounded-[10px] px-3 py-2 text-left text-[13.5px] hover:bg-surface-2"><span>{l}</span><span className="text-muted">{d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span></button>)}
        <div className="mt-2 flex gap-2">
          <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Pick a time" />
          <Button variant="primary" disabled={!custom || new Date(custom).getTime() < now + 60_000} onClick={() => onPick(new Date(custom).toISOString())}>Set</Button>
        </div>
      </div>
    </Dialog>
  );
}

function LinkDialog({ onClose, onPick }: { onClose: () => void; onPick: (label: string, url: string) => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("https://");
  const ok = /^https?:\/\/\S+\.\S+/.test(url);
  return (
    <Dialog open onClose={onClose} size="sm" title="Add a link" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onPick(label.trim(), url.trim())}>Add</Button></>}>
      <div className="grid gap-2">
        <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Text to show" aria-label="Text" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-label="Address" />
      </div>
    </Dialog>
  );
}
