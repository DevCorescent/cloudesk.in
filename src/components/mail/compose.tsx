"use client";

// Writing mail: a new message (in a dialog) or a reply, reply-all or forward
// (inline under the conversation). Recipients as chips (paste many at once),
// templates with variables (or type /shortcut), attachments by drag and drop,
// send now (with an undo window), schedule for later, and a "remind me if
// nobody replies" follow-up. Drafts are kept on this device as you type.
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, FileText, FolderOpen, Paperclip, PauseCircle, Send, Users, X, Repeat } from "lucide-react";
import { DocumentPicker, attachmentOf, useDocumentsOn } from "@/components/documents/picker";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as RKE } from "react";
import { Dialog, Menu, useToast } from "@/components/ui/overlays";
import { Button, IconButton, Input, Select, cx } from "@/components/ui/primitives";
import { useShortcuts } from "@/components/ui/shortcut";
import { errorMessage } from "@/lib/client/api";
import type { AccountOut, MessageOut, SendIn, SendOut, Suggestion, TemplateOut, ThreadOut } from "@/lib/mail/api";
import { fillTemplate } from "@/lib/mail/model";
import { SignaturePicker, SignaturePreview, useSignatures } from "./signatures";
import { ScheduleEditor } from "./recurring";
import { addressesIn, drafts, EMAIL, fileSize, mailKey, personName, presets, useMailApi, useMailMeta, useMailRefresh, useUndoSend } from "./shared";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";
type Attachment = { filename: string; mime: string; data: string; size: number };
const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;

export type GroupChip = { id: string; name: string; count: number; color: string };

/**
 * Recipient chips with suggestions as you type — address-book groups and
 * contacts, CRM, teammates and people you've emailed. Paste many addresses at
 * once; Enter, comma or space adds one; arrows pick a suggestion. Groups (To
 * only) become their members when it's sent.
 */
export function Recipients({ label, value, onChange, autoFocus, groups, onGroups, known }: { label: string; value: string[]; onChange: (v: string[]) => void; autoFocus?: boolean; groups?: GroupChip[]; onGroups?: (g: GroupChip[]) => void; known?: Record<string, string> }) {
  const { orgId, call } = useMailApi();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [names, setNames] = useState<Record<string, string>>({});
  const listId = useId();
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 140);
    return () => clearTimeout(t);
  }, [text]);
  const sug = useQuery({ queryKey: mailKey(orgId, "suggest", q), queryFn: () => call<{ suggestions: Suggestion[] }>(`suggest?q=${encodeURIComponent(q)}`), enabled: open, staleTime: 30_000 });
  const list = (sug.data?.suggestions ?? []).filter((x) => (x.kind === "group" ? !!onGroups && !groups?.some((g) => g.id === x.id) : !value.includes(x.email)));
  const add = (raw: string) => {
    const found = addressesIn(raw);
    if (found.length) onChange([...new Set([...value, ...found])]);
    setText(found.length ? "" : raw);
  };
  const pick = (x: Suggestion) => {
    if (x.kind === "group") onGroups?.([...(groups ?? []), { id: x.id!, name: x.name, count: x.count ?? 0, color: x.color ?? "#2563eb" }]);
    else {
      onChange([...new Set([...value, x.email])]);
      if (x.name) setNames((n) => ({ ...n, [x.email]: x.name }));
    }
    setText("");
    setHi(0);
  };
  return (
    <div className="relative flex min-h-10 flex-wrap items-center gap-1.5 border-b border-border px-1 py-1.5">
      <span className="w-12 shrink-0 text-[12.5px] text-muted">{label}</span>
      {groups?.map((g) => (
        <span key={g.id} className="inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-[12.5px] font-medium text-white" style={{ background: g.color }} title={`${g.count} ${g.count === 1 ? "person" : "people"}`}>
          <Users className="size-3" />{g.name}<span className="opacity-75">· {g.count}</span>
          <button type="button" aria-label={`Remove ${g.name}`} onClick={() => onGroups?.(groups.filter((x) => x.id !== g.id))} className="grid size-4 place-items-center rounded-full hover:bg-white/20"><X className="size-3" /></button>
        </span>
      ))}
      {value.map((a) => (
        <span key={a} title={a} className={cx("inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-[12.5px]", EMAIL.test(a) ? "bg-surface-2" : "bg-danger-soft text-danger")}>
          <span className="truncate">{names[a] || known?.[a] || a}</span>
          <button type="button" aria-label={`Remove ${a}`} onClick={() => onChange(value.filter((x) => x !== a))} className="grid size-4 place-items-center rounded-full hover:bg-fg/10">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        role="combobox"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-expanded={open && list.length > 0}
        autoFocus={autoFocus}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setOpen(true);
          setHi(0);
          if (/[,;]$/.test(e.target.value) || (/\s$/.test(e.target.value) && EMAIL.test(e.target.value.trim()))) add(e.target.value);
          else setText(e.target.value);
        }}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text");
          if (addressesIn(t).length > 1) {
            e.preventDefault();
            add(t);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && list.length) {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, list.length - 1));
          } else if (e.key === "ArrowUp" && list.length) {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if ((e.key === "Enter" || e.key === "Tab") && open && list[hi] && (text.trim() || e.key === "Enter")) {
            if (EMAIL.test(text.trim()) && !list[hi]!.email.startsWith(text.trim().toLowerCase())) return void (e.preventDefault(), add(text));
            e.preventDefault();
            pick(list[hi]!);
          } else if (e.key === "Enter" && text.trim()) {
            e.preventDefault();
            add(text);
          } else if (e.key === "Escape") setOpen(false);
          else if (e.key === "Backspace" && !text) {
            if (value.length) onChange(value.slice(0, -1));
            else if (groups?.length) onGroups?.(groups.slice(0, -1));
          }
        }}
        onBlur={() => {
          // Picks happen on mousedown (no blur), so it can close straight away.
          setOpen(false);
          if (text.trim()) add(text);
        }}
        className="min-w-[8rem] flex-1 bg-transparent py-1 text-[13.5px] outline-none placeholder:text-subtle"
        style={{ outline: "none" }}
        placeholder={value.length || groups?.length ? "" : "Name, email or group"}
      />
      {open && list.length > 0 && (
        <ul id={listId} role="listbox" className="absolute top-full right-0 left-12 z-40 mt-1 max-h-72 overflow-y-auto rounded-[14px] border border-border bg-[var(--surface-solid)] p-1.5 shadow-2xl">
          {list.map((x, i) => (
            <li key={x.kind === "group" ? `g${x.id}` : x.email} role="option" aria-selected={i === hi}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(x); }} onMouseEnter={() => setHi(i)} className={cx("flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left", i === hi && "bg-surface-2")}>
                {x.kind === "group" ? (
                  <span className="grid size-7 shrink-0 place-items-center rounded-full text-white" style={{ background: x.color }}><Users className="size-3.5" /></span>
                ) : (
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold">{(x.name || x.email).slice(0, 1).toUpperCase()}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{x.kind === "group" ? `${x.name} · ${x.count} ${x.count === 1 ? "person" : "people"}` : x.name || x.email}</span>
                  {x.kind === "person" && <span className="block truncate text-[11.5px] text-muted">{x.email}{x.company ? ` · ${x.company}` : ""}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10.5px] text-muted">{x.source}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const quoteOf = (m: MessageOut) => `\n\nOn ${new Date(m.date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}, ${personName(m.from)} <${m.from.address}> wrote:\n${m.text.split("\n").map((l) => `> ${l}`).join("\n")}`;
const prefix = (p: string, s: string) => (new RegExp(`^${p}:`, "i").test(s.trim()) ? s : `${p}: ${s}`);

/** What a reply/forward starts with. */
function initial(mode: ComposeMode, accounts: AccountOut[], thread: ThreadOut | null, msg: MessageOut | null, accountId: string) {
  const mine = new Set(accounts.map((a) => a.address.toLowerCase()));
  if (!thread || !msg || mode === "new") return { to: [] as string[], cc: [] as string[], subject: "", quote: "" };
  if (mode === "forward") return { to: [], cc: [], subject: prefix("Fwd", msg.subject), quote: `\n\n---------- Forwarded message ----------\nFrom: ${personName(msg.from)} <${msg.from.address}>\nDate: ${new Date(msg.date).toLocaleString("en-IN")}\nSubject: ${msg.subject}\nTo: ${msg.to.map((p) => p.address).join(", ")}\n\n${msg.text}` };
  const replyTarget = msg.direction === "out" ? msg.to.map((p) => p.address) : [msg.replyTo || msg.from.address];
  const to = replyTarget.filter((a) => !mine.has(a.toLowerCase()) || msg.direction === "out");
  const cc = mode === "replyAll" ? [...msg.to, ...msg.cc].map((p) => p.address).filter((a) => !mine.has(a.toLowerCase()) && !to.includes(a)) : [];
  void accountId;
  return { to, cc, subject: prefix("Re", msg.subject), quote: quoteOf(msg) };
}

/** What another module fills a new email with ("Email" buttons around the app). */
export type ComposePreset = { to?: string[]; cc?: string[]; /** Names for the addresses, shown on the chips. */ names?: Record<string, string>; subject?: string; body?: string; groups?: GroupChip[]; attachments?: { url: string; filename: string }[]; title?: string; accountId?: string };

export function Composer({ mode, accounts, thread, message, defaultAccount, inline, onClose, onSent, draftKey, prefill, preset }: { mode: ComposeMode; accounts: AccountOut[]; thread: ThreadOut | null; message: MessageOut | null; defaultAccount?: string; inline?: boolean; onClose: () => void; onSent?: () => void; draftKey: string; prefill?: string; preset?: ComposePreset }) {
  const { orgId, call } = useMailApi();
  const toast = useToast();
  const refresh = useMailRefresh();
  const meta = useMailMeta().data;
  const { withKeys, keys } = useShortcuts();
  const sendKeys = keys("mod+enter");
  const undo = useUndoSend();
  const sendable = accounts.filter((a) => a.status !== "paused");
  const [accountId, setAccountId] = useState(thread?.thread.accountId ?? (preset?.accountId && sendable.some((a) => a.id === preset.accountId) ? preset.accountId : undefined) ?? defaultAccount ?? sendable[0]?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const init = useMemo(() => initial(mode, accounts, thread, message, accountId), [mode, accounts, thread, message, accountId]);
  const saved = useMemo(() => {
    try {
      return JSON.parse(drafts.get(draftKey) ?? "null") as { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string } | null;
    } catch {
      return null;
    }
  }, [draftKey]);
  // A preset (from another module) wins over an old draft.
  const [to, setTo] = useState<string[]>(preset?.to?.map((x) => x.toLowerCase()) ?? saved?.to ?? init.to);
  const [cc, setCc] = useState<string[]>(preset?.cc ?? saved?.cc ?? init.cc);
  const [groups, setGroups] = useState<GroupChip[]>(preset?.groups ?? []);
  const [separately, setSeparately] = useState(false);
  const [bcc, setBcc] = useState<string[]>(saved?.bcc ?? []);
  const [showCc, setShowCc] = useState(!!(saved?.cc?.length || saved?.bcc?.length || init.cc.length));
  const [subject, setSubject] = useState(preset?.subject ?? saved?.subject ?? init.subject);
  const sig = account?.signature ? `\n\n-- \n${account.signature}` : "";
  const [body, setBody] = useState(preset?.body !== undefined ? `${preset.body}${sig}` : (saved?.body ?? `${prefill ?? ""}${sig}${init.quote}`));
  const [files, setFiles] = useState<Attachment[]>([]);
  // Files another module attaches (an invoice PDF…): fetched from the app as you.
  const [attaching, setAttaching] = useState<string[]>(preset?.attachments?.map((a) => a.filename) ?? []);
  /** Fetches files from the app (as you) and attaches them; their names show as "Attaching…" until then. */
  const fetchAttachments = async (list: { url: string; filename: string }[], live: () => boolean) => {
    const got: Attachment[] = [];
    for (const a of list) {
      try {
        const res = await fetch(a.url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (blob.size > MAX_FILE) throw new Error("too big");
        const data = await new Promise<string>((ok, bad) => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result).split(",")[1] ?? "");
          r.onerror = () => bad(r.error);
          r.readAsDataURL(blob);
        });
        got.push({ filename: a.filename, mime: blob.type || "application/octet-stream", data, size: blob.size });
      } catch {
        if (live()) toast({ tone: "error", title: `Couldn't attach ${a.filename}`, description: "Attach it by hand, or share its link." });
      }
    }
    if (live()) {
      setFiles((f) => [...f, ...got]);
      setAttaching((x) => x.filter((n) => !list.some((a) => a.filename === n)));
    }
  };
  useEffect(() => {
    if (!preset?.attachments?.length) return;
    let live = true;
    // After this render, so the effect itself never sets state.
    void Promise.resolve().then(() => fetchAttachments(preset.attachments!, () => live));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the preset
  }, []);
  const [picking, setPicking] = useState(false);
  const docsOn = useDocumentsOn();
  const [keepAttachments, setKeepAttachments] = useState(mode === "forward" && (message?.attachments.length ?? 0) > 0);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [sendAt, setSendAt] = useState<string | null>(null);
  const [custom, setCustom] = useState<"schedule" | "follow" | null>(null);
  // "Repeat on a schedule": this draft becomes a recurring email.
  const [repeating, setRepeating] = useState(false);
  const [customAt, setCustomAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const templates = useQuery({ queryKey: mailKey(orgId, "templates"), queryFn: () => call<{ templates: TemplateOut[] }>("templates") });
  // Designed signatures: this mailbox's default (for new mail, or for replies and forwards), or the one picked here.
  const sigQ = useSignatures();
  const sigs = sigQ.data?.signatures ?? [];
  const hasSigs = sigs.length > 0;
  const sigDefaults = sigQ.data?.defaults[accountId];
  const defaultSig = sigDefaults ? (mode === "new" ? sigDefaults.newId : sigDefaults.replyId) : (sigs[0]?.id ?? null);
  const [pickedSig, setPickedSig] = useState<string | null | undefined>(undefined);
  const sigId = pickedSig !== undefined ? pickedSig : defaultSig;
  const chosenSig = sigs.find((x) => x.id === sigId) ?? null;
  // With designed signatures the plain one isn't typed into the message (it's added when sending).
  const [plainStripped, setPlainStripped] = useState(false);
  if (hasSigs && !plainStripped) {
    setPlainStripped(true);
    if (sig && body.includes(sig)) setBody(body.replace(sig, ""));
  }

  useEffect(() => {
    const t = setTimeout(() => drafts.set(draftKey, JSON.stringify({ to, cc, bcc, subject, body })), 400);
    return () => clearTimeout(t);
  }, [draftKey, to, cc, bcc, subject, body]);

  const recipient = thread?.messages.find((m) => m.direction === "in")?.from ?? null;
  const applyTemplate = (t: TemplateOut, replaceShortcut?: string) => {
    const filled = fillTemplate(t.body, { name: recipient?.name, email: recipient?.address, company: thread?.contact?.company ?? undefined, myName: account?.displayName || undefined });
    if (t.subject && !subject.trim()) setSubject(fillTemplate(t.subject, { name: recipient?.name, email: recipient?.address, myName: account?.displayName || undefined }));
    setBody((b) => (replaceShortcut ? b.replace(replaceShortcut, filled) : `${filled}${b.startsWith("\n") ? "" : "\n"}${b}`));
    setTemplateId(t.id);
  };

  const addFiles = async (list: FileList | File[]) => {
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) {
        toast({ tone: "error", title: `${f.name} is over 15 MB`, description: "Share a link instead." });
        continue;
      }
      if (next.reduce((a, x) => a + x.size, 0) + f.size > MAX_TOTAL) {
        toast({ tone: "error", title: "Attachments are limited to 25 MB in total" });
        break;
      }
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = () => rej(r.error);
        r.readAsDataURL(f);
      });
      next.push({ filename: f.name, mime: f.type || "application/octet-stream", data, size: f.size });
    }
    setFiles(next);
  };

  const invalid = [...to, ...cc, ...bcc].filter((a) => !EMAIL.test(a));
  const people = to.length + groups.reduce((n, g) => n + g.count, 0);
  const canSeparate = mode === "new" && people > 1;
  const send = async (when?: string) => {
    if (!account) return toast({ tone: "error", title: "Pick a mailbox to send from" });
    if (!to.length && !cc.length && !bcc.length && !groups.length) return toast({ tone: "error", title: "Add at least one recipient" });
    if (attaching.length) return toast({ tone: "error", title: "Still attaching — one moment" });
    if (invalid.length) return toast({ tone: "error", title: `Check ${invalid[0]}` });
    setBusy(true);
    try {
      const payload: SendIn = {
        accountId,
        threadId: mode === "new" ? undefined : thread?.thread.id,
        replyTo: mode === "new" ? undefined : message?.id,
        mode,
        to,
        cc,
        bcc,
        subject: subject.trim() || "(no subject)",
        body,
        sendAt: when ?? sendAt ?? undefined,
        followUpAt: followUp ?? undefined,
        attachments: files.map(({ filename, mime, data }) => ({ filename, mime, data })),
        templateId,
        signatureId: hasSigs ? sigId : undefined,
        groupIds: groups.map((g) => g.id),
        separately: canSeparate && separately,
        forwardAttachments: keepAttachments && message ? message.attachments.filter((a) => a.stored).map((a) => a.id) : undefined,
      };
      const r = await call<SendOut>("send", "POST", payload);
      drafts.clear(draftKey);
      const scheduled = when ?? sendAt;
      if ((r.count ?? 1) > 1) toast({ tone: "success", title: `Sending to ${r.count} people`, description: "One email each — nobody sees the others." });
      else if (scheduled) {
        toast({ tone: "success", title: "Scheduled", description: `Sends ${new Date(scheduled).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}. Cancel it from Scheduled.` });
      } else {
        const secs = Math.max(0, Math.round((new Date(r.message.sendAt).getTime() - Date.now()) / 1000));
        undo.show({ id: r.message.id, seconds: secs, label: mode === "new" ? "Message" : mode === "forward" ? "Forward" : "Reply" });
      }
      void refresh();
      onSent?.();
      onClose();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const onBodyKey = (e: RKE<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
      return;
    }
    // "/shortcut" + space or Tab inserts a template.
    if ((e.key === " " || e.key === "Tab") && templates.data) {
      const el = e.currentTarget;
      const before = el.value.slice(0, el.selectionStart);
      const m = before.match(/(?:^|\s)\/([a-z0-9-]+)$/);
      const t = m && templates.data.templates.find((x) => x.shortcut === m[1]);
      if (t && m) {
        e.preventDefault();
        applyTemplate(t, `/${m[1]}`);
      }
    }
  };

  const followOptions = [
    { label: "In 2 days", days: 2 },
    { label: "In 1 week", days: 7 },
  ];

  const editor = (
    <div
      data-testid="mail-compose"
      className={cx("relative flex min-h-0 flex-col", inline ? "rounded-[18px] border border-border bg-surface transition-colors focus-within:border-fg/30 shadow-[0_8px_30px_-18px_rgb(0_0_0/0.3)]" : "")}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      {drag && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[18px] border-2 border-dashed border-accent bg-accent/10 text-[14px] font-medium text-accent">Drop to attach</div>}
      <div className={cx(inline ? "px-4 pt-2" : "")}>
        {(sendable.length > 1 || mode === "new") && sendable.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border px-1 py-1.5">
            <span className="w-12 shrink-0 text-[12.5px] text-muted">From</span>
            {sendable.length > 1 ? (
              <Select aria-label="From" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="!h-8 !border-0 !bg-transparent !px-0 !shadow-none">
                {sendable.map((a) => (
                  <option key={a.id} value={a.id}>{a.displayName ? `${a.displayName} <${a.address}>` : a.address}</option>
                ))}
              </Select>
            ) : (
              <span className="flex h-8 items-center gap-2 text-[13.5px]"><span className="size-2 rounded-full" style={{ background: account?.color }} />{account?.displayName ? `${account.displayName} <${account.address}>` : account?.address}</span>
            )}
          </div>
        )}
        <div className="relative">
          <Recipients label="To" value={to} onChange={setTo} groups={mode === "new" ? groups : undefined} onGroups={mode === "new" ? setGroups : undefined} autoFocus={(mode === "new" && !preset?.to?.length) || mode === "forward"} known={preset?.names} />
          {!showCc && (
            <button type="button" onClick={() => setShowCc(true)} className="absolute top-2 right-1 rounded-full px-2 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg">Cc Bcc</button>
          )}
        </div>
        {showCc && (
          <>
            <Recipients label="Cc" value={cc} onChange={setCc} known={preset?.names} />
            <Recipients label="Bcc" value={bcc} onChange={setBcc} />
          </>
        )}
        {(mode === "new" || mode === "forward") && (
          <div className="flex items-center gap-2 border-b border-border px-1">
            <span className="w-12 shrink-0 text-[12.5px] text-muted">Subject</span>
            <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-10 flex-1 bg-transparent text-[14px] font-medium outline-none" style={{ outline: "none" }} />
          </div>
        )}
        {canSeparate && (
          <label className="flex items-center gap-2 border-b border-border px-1 py-2 text-[12.5px]">
            <input type="checkbox" checked={separately} onChange={(e) => setSeparately(e.target.checked)} className="size-3.5 accent-sky-600" />
            <span><b className="font-semibold">Send separately to each of the {people}</b> <span className="text-muted">— nobody sees the others, and {"{{first_name}}"} becomes each person&apos;s own name</span></span>
          </label>
        )}
      </div>
      <textarea
        ref={area}
        aria-label="Message"
        value={body}
        autoFocus={mode === "reply" || mode === "replyAll"}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onBodyKey}
        placeholder="Write your message… (type / and a template shortcut)"
        style={{ outline: "none" }}
        className={cx("w-full flex-1 resize-none bg-transparent px-1 py-3 text-[14px] leading-relaxed outline-none placeholder:text-subtle", inline ? "min-h-[180px] px-4" : "min-h-[280px]")}
        onFocus={(e) => {
          if (mode !== "new" && e.currentTarget.selectionStart === e.currentTarget.value.length && init.quote) e.currentTarget.setSelectionRange(0, 0);
        }}
      />
      {hasSigs && chosenSig && (
        <div className={cx("pb-2", inline ? "px-4" : "px-1")}>
          <p className="mb-1 text-[11px] font-medium text-muted">{init.quote ? "Signature — goes above the quoted text" : "Signature"}</p>
          <div className="max-h-[150px] overflow-hidden rounded-[12px] border border-dashed border-border bg-white px-3 py-2.5 opacity-90">
            <SignaturePreview design={chosenSig.design} fields={chosenSig.fields} className="pointer-events-none w-[118%] origin-top-left scale-[0.85]" />
          </div>
        </div>
      )}
      {attaching.length > 0 && <p className={cx("pb-2 text-[12px] text-muted", inline ? "px-4" : "px-1")}>Attaching {attaching.join(", ")}…</p>}
      {(files.length > 0 || keepAttachments) && (
        <div className={cx("flex flex-wrap gap-1.5 pb-2", inline ? "px-4" : "px-1")}>
          {keepAttachments && message?.attachments.filter((a) => a.stored).map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 rounded-[10px] bg-surface-2 px-2.5 py-1 text-[12px]"><Paperclip className="size-3" />{a.filename} <span className="text-muted">{fileSize(a.size)}</span></span>
          ))}
          {keepAttachments && <button type="button" onClick={() => setKeepAttachments(false)} className="text-[12px] text-muted underline">Don&apos;t forward attachments</button>}
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-[10px] bg-surface-2 py-1 pr-1 pl-2.5 text-[12px]">
              <Paperclip className="size-3" />
              <span className="max-w-[12rem] truncate">{f.filename}</span>
              <span className="text-muted">{fileSize(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="grid size-5 place-items-center rounded-full hover:bg-fg/10"><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
      {(sendAt || followUp) && (
        <div className={cx("flex flex-wrap gap-2 pb-2 text-[12px]", inline ? "px-4" : "px-1")}>
          {sendAt && <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-accent"><CalendarClock className="size-3" /> Sends {new Date(sendAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}<button type="button" aria-label="Clear schedule" onClick={() => setSendAt(null)}><X className="size-3" /></button></span>}
          {followUp && <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-warning">Remind me if no reply by {new Date(followUp).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}<button type="button" aria-label="Clear reminder" onClick={() => setFollowUp(null)}><X className="size-3" /></button></span>}
        </div>
      )}
      {custom && (
        <div className={cx("flex flex-wrap items-center gap-2 pb-2", inline ? "px-4" : "px-1")}>
          <Input type="datetime-local" aria-label={custom === "schedule" ? "Send at" : "Remind me at"} value={customAt} onChange={(e) => setCustomAt(e.target.value)} className="!w-auto" />
          <Button size="sm" disabled={!customAt || new Date(customAt) <= new Date()} onClick={() => {
            const iso = new Date(customAt).toISOString();
            if (custom === "schedule") setSendAt(iso);
            else setFollowUp(iso);
            setCustom(null);
          }}>Set</Button>
          <Button size="sm" variant="ghost" onClick={() => setCustom(null)}>Cancel</Button>
        </div>
      )}
      <div className={cx("flex flex-wrap items-center gap-1.5 border-t border-border py-2.5", inline ? "px-3" : "")}>
        <div className="flex items-center">
          <Button variant="primary" loading={busy} icon={<Send className="size-3.5" />} onClick={() => void send()} className="!rounded-r-none" title={withKeys("Send", "mod+enter")}>
            {sendAt ? "Schedule" : "Send"}
          </Button>
          <Menu
            label="Send options"
            align="start"
            trigger={(p) => (
              <button {...p} type="button" aria-label="Schedule send" className="grid h-8 w-7 place-items-center rounded-r-full border-l border-white/20 bg-accent text-accent-fg hover:brightness-110">
                <ChevronDown className="size-3.5" />
              </button>
            )}
            items={[...presets().map((p) => ({ label: `Send ${p.label.toLowerCase()}`, icon: <CalendarClock />, onSelect: () => setSendAt(p.at.toISOString()) })), { label: "Pick a date and time…", icon: <CalendarClock />, onSelect: () => setCustom("schedule") }, ...(mode === "new" ? ["separator" as const, { label: "Repeat on a schedule…", icon: <Repeat />, onSelect: () => setRepeating(true) }] : [])]}
          />
        </div>
        <Menu
          label="Follow-up reminder"
          align="start"
          trigger={(p) => <Button {...p} size="sm" variant="ghost">Remind me</Button>}
          items={[...followOptions.map((o) => ({ label: `If no reply ${o.label.toLowerCase()}`, onSelect: () => setFollowUp(new Date(Date.now() + o.days * 86_400_000).toISOString()) })), { label: "Pick a date…", onSelect: () => setCustom("follow") }]}
        />
        {hasSigs && <SignaturePicker signatures={sigs} value={sigId} onChange={setPickedSig} />}
        {!!templates.data?.templates.length && (
          <Menu
            label="Insert template"
            align="start"
            trigger={(p) => <Button {...p} size="sm" variant="ghost" icon={<FileText className="size-3.5" />}>Templates</Button>}
            items={templates.data.templates.map((t) => ({ label: t.shortcut ? `${t.name} · /${t.shortcut}` : t.name, onSelect: () => applyTemplate(t) }))}
          />
        )}
        <IconButton label="Attach files" icon={<Paperclip className="size-4" />} onClick={() => fileInput.current?.click()} />
        {docsOn && <IconButton label="Attach from Documents" icon={<FolderOpen className="size-4" />} onClick={() => setPicking(true)} />}
        {picking && <DocumentPicker onClose={() => setPicking(false)} onPick={(fs) => {
              const list = fs.map((f) => attachmentOf(orgId, f));
              setAttaching((x) => [...x, ...list.map((a) => a.filename)]);
              void fetchAttachments(list, () => true);
            }} />}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
        {!inline && sendKeys && <span className="ml-auto hidden text-[11.5px] text-subtle sm:inline">{sendKeys} to send</span>}
        <Button size="sm" variant="ghost" className={inline ? "ml-auto" : undefined} onClick={() => { drafts.clear(draftKey); onClose(); }}>Discard</Button>
      </div>
    </div>
  );

  const repeatEditor = repeating && meta && (
    <ScheduleEditor
      meta={meta}
      draft={{ accountId, to, cc, bcc, groups, separately: canSeparate && separately, subject: subject.trim(), body, ...(hasSigs ? { signatureId: sigId } : {}), pending: files }}
      onClose={() => setRepeating(false)}
      onSaved={() => { setRepeating(false); drafts.clear(draftKey); void refresh(); onClose(); }}
    />
  );
  if (inline) return <>{editor}{repeatEditor}</>;
  return (
    <Dialog open onClose={onClose} size="lg" title={preset?.title ?? (mode === "forward" ? "Forward" : "New message")}>
      {sendable.length ? (
        <>{editor}{repeatEditor}</>
      ) : (
        <div className="grid justify-items-center gap-3 py-8 text-center">
          <span className="grid size-12 place-items-center rounded-[16px] bg-amber-500/10 text-amber-600"><PauseCircle className="size-6" /></span>
          <div>
            <p className="text-[15px] font-semibold">{accounts.length ? "Your mailboxes are paused" : "No mailbox yet"}</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted">{accounts.length ? "Resume a mailbox to send from it. Paused mailboxes don't sync or send." : "Connect a mailbox first to send mail."}</p>
          </div>
          <Link href="/mail/settings" onClick={onClose} className="inline-flex h-9 items-center rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">Open mailbox settings</Link>
        </div>
      )}
    </Dialog>
  );
}
