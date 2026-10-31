"use client";

// Inviting people from outside the workspace into one conversation: invite
// links (expiry, how many people, approval, history, files), sharing them
// (copy, QR, WhatsApp, email from Cloudesk or your own mailbox, text,
// Telegram, Teams and more), and letting people in — waiting requests,
// guests in the conversation, and everyone who came before.
import { useQuery } from "@tanstack/react-query";
import { Check, Clock3, Copy, Download, Link2, Mail, MessageCircle, MessageSquare, Plus, QrCode, Send, Share2, ShieldCheck, UserCheck, UserMinus, Users, UserX, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useCompose } from "@/components/mail/compose-provider";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Select, Switch, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { copyText } from "@/lib/client/copy";
import type { ChannelOut, GuestOut, InviteOut, MetaOut, PersonOut } from "@/lib/chat/api";
import { EXPIRY_CHOICES, GUEST_STATUS_LABEL, inviteText, shareTargets, USES_CHOICES, type Expiry } from "@/lib/chat/guests";
import { qrSvg } from "@/lib/store/barcode";
import { Avatar, channelTitle, chatKey, longWhen, shortWhen, useChatApi } from "./shared";

type Tab = "invite" | "requests" | "guests" | "links";

export function GuestsDialog({ channel, meta, people, initial, onClose, onChanged }: { channel: ChannelOut; meta: MetaOut; people: Map<string, PersonOut>; initial?: Tab; onClose: () => void; onChanged: () => void }) {
  const { call, orgId } = useChatApi();
  const toast = useToast();
  const invites = useQuery({ queryKey: chatKey(orgId, "invites", channel.id), queryFn: () => call<{ invites: InviteOut[] }>(`channels/${channel.id}/invites`) });
  const guests = useQuery({ queryKey: chatKey(orgId, "guests", channel.id), queryFn: () => call<{ guests: GuestOut[] }>(`channels/${channel.id}/guests`), refetchInterval: 15_000 });
  const pending = (guests.data?.guests ?? []).filter((g) => g.status === "pending");
  const inNow = (guests.data?.guests ?? []).filter((g) => g.status === "approved");
  const [tab, setTab] = useState<Tab>(initial ?? (channel.requests > 0 ? "requests" : "invite"));
  const where = channel.kind === "channel" ? `#${channel.name}` : channelTitle(channel, people);

  const run = async (f: () => Promise<unknown>, ok?: string) => {
    try {
      await f();
      if (ok) toast({ tone: "success", title: ok });
      void invites.refetch();
      void guests.refetch();
      onChanged();
      return true;
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return false;
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "invite", label: "Invite" },
    { id: "requests", label: pending.length ? `Requests · ${pending.length}` : "Requests" },
    { id: "guests", label: inNow.length ? `Guests · ${inNow.length}` : "Guests" },
    { id: "links", label: "Invite links" },
  ];

  return (
    <Dialog open onClose={onClose} size="lg" title={`Invite people to ${where}`} description="Anyone can join with just their name — no Cloudesk account. They see only this conversation.">
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cx("h-8 rounded-full px-3 text-[13px]", tab === t.id ? "bg-fg font-medium text-bg" : "text-muted hover:bg-surface-2", t.id === "requests" && pending.length > 0 && tab !== t.id && "font-semibold text-teal-700 dark:text-teal-300")}>{t.label}</button>
        ))}
      </div>
      {tab === "invite" && <InviteTab channel={channel} meta={meta} where={where} invites={invites.data?.invites ?? null} run={run} onClose={onClose} />}
      {tab === "requests" && <Requests list={pending} loading={guests.isLoading} run={run} />}
      {tab === "guests" && <GuestList list={guests.data?.guests ?? []} people={people} run={run} />}
      {tab === "links" && <Links list={invites.data?.invites ?? []} run={run} onNew={() => setTab("invite")} />}
    </Dialog>
  );
}

type Run = (f: () => Promise<unknown>, ok?: string) => Promise<boolean>;

// ── Invite: make a link, then send it anywhere ─────────────────────────────

function InviteTab({ channel, meta, where, invites, run, onClose }: { channel: ChannelOut; meta: MetaOut; where: string; invites: InviteOut[] | null; run: Run; onClose: () => void }) {
  const { call } = useChatApi();
  const usable = (invites ?? []).filter((i) => !i.problem);
  const [pick, setPick] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const current = usable.find((i) => i.id === pick) ?? usable[0] ?? null;
  if (!invites) return <p className="py-8 text-center text-[13px] text-muted">Loading…</p>;
  if (!current || making) {
    return (
      <NewInvite
        archived={channel.archived}
        onCancel={current ? () => setMaking(false) : undefined}
        onMake={async (v) => {
          let made: InviteOut | null = null;
          const ok = await run(async () => {
            made = (await call<{ invite: InviteOut }>(`channels/${channel.id}/invites`, "POST", v)).invite;
          }, "Invite link ready");
          if (ok && made) {
            setPick((made as InviteOut).id);
            setMaking(false);
          }
        }}
      />
    );
  }
  return (
    <div className="grid gap-5">
      {usable.length > 1 && (
        <Field label="Invite link">
          {(p) => (
            <Select {...p} value={current.id} onChange={(e) => setPick(e.target.value)}>
              {usable.map((i) => <option key={i.id} value={i.id}>{i.label || "Invite link"} · {summary(i)}</option>)}
            </Select>
          )}
        </Field>
      )}
      <Share invite={current} where={where} meta={meta} onClose={onClose} run={run} />
      <button type="button" onClick={() => setMaking(true)} className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-[13px] font-medium text-sky-700 hover:bg-sky-500/10 dark:text-sky-400"><Plus className="size-3.5" />New link with different settings</button>
    </div>
  );
}

const summary = (i: InviteOut) => [i.approval ? "you approve each person" : "joins straight away", i.maxUses ? `${i.uses}/${i.maxUses} used` : `${i.uses} used`, i.expiresAt ? `until ${shortWhen(i.expiresAt)}` : "never expires"].join(" · ");

function NewInvite({ archived, onMake, onCancel }: { archived: boolean; onMake: (v: { label: string; expires: Expiry; maxUses: number; approval: boolean; history: boolean; files: boolean }) => Promise<void>; onCancel?: () => void }) {
  const [v, setV] = useState({ label: "", expires: "7d" as Expiry, maxUses: 0, approval: true, history: false, files: true });
  const [busy, setBusy] = useState(false);
  if (archived) return <p className="rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-muted">This channel is archived. Bring it back to invite people.</p>;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onMake(v);
        setBusy(false);
      }}
    >
      <Field label="Name for this link (optional)" hint="Only you and other admins see it — e.g. “Suppliers” or “Client team”.">{(p) => <Input {...p} value={v.label} maxLength={60} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="Client team" />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Link stops working after">{(p) => <Select {...p} value={v.expires} onChange={(e) => setV({ ...v, expires: e.target.value as Expiry })}>{EXPIRY_CHOICES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select>}</Field>
        <Field label="How many people can use it">{(p) => <Select {...p} value={String(v.maxUses)} onChange={(e) => setV({ ...v, maxUses: Number(e.target.value) })}>{USES_CHOICES.map((n) => <option key={n} value={n}>{n === 0 ? "No limit" : n === 1 ? "1 person" : `${n} people`}</option>)}</Select>}</Field>
      </div>
      <div className="grid gap-3 rounded-[14px] border border-border p-3.5">
        <Toggle on={v.approval} set={(x) => setV({ ...v, approval: x })} title="An admin lets each person in" sub={v.approval ? "Recommended. You'll be notified and approve or decline each request." : "Anyone with the link joins straight away — share it carefully."} />
        <Toggle on={v.history} set={(x) => setV({ ...v, history: x })} title="Guests see earlier messages" sub={v.history ? "They can read everything said here before they joined." : "They see only what's said after they join."} />
        <Toggle on={v.files} set={(x) => setV({ ...v, files: x })} title="Guests can share files" sub="Up to 25 MB each." />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy} icon={<Link2 className="size-4" />}>Create invite link</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function Toggle({ on, set, title, sub }: { on: boolean; set: (v: boolean) => void; title: string; sub: string }) {
  return (
    <label className="flex items-start gap-3">
      <Switch label={title} checked={on} onChange={set} />
      <span className="grid gap-0.5"><span className="text-[13.5px] font-medium">{title}</span><span className="text-[12px] text-muted">{sub}</span></span>
    </label>
  );
}

function Tile({ href, label, tone, glyph, newTab, onClick }: { href?: string; label: string; tone: string; glyph: ReactNode; newTab?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span className={cx("grid size-11 place-items-center rounded-[14px] text-[15px] font-bold text-white shadow-sm [&>svg]:size-5", tone)}>{glyph}</span>
      <span className="max-w-[76px] truncate text-[11.5px] text-muted">{label}</span>
    </>
  );
  const cls = "flex flex-col items-center gap-1.5 rounded-[14px] p-1.5 hover:bg-surface-2";
  return href ? <a href={href} target={newTab ? "_blank" : undefined} rel="noopener noreferrer" className={cls} onClick={onClick}>{inner}</a> : <button type="button" className={cls} onClick={onClick}>{inner}</button>;
}

const GLYPH: Record<string, { tone: string; glyph: ReactNode }> = {
  whatsapp: { tone: "bg-[#25d366]", glyph: <MessageCircle /> },
  email: { tone: "bg-slate-600", glyph: <Mail /> },
  sms: { tone: "bg-emerald-600", glyph: <MessageSquare /> },
  telegram: { tone: "bg-[#229ed9]", glyph: <Send /> },
  teams: { tone: "bg-[#5b5fc7]", glyph: <Users /> },
  linkedin: { tone: "bg-[#0a66c2]", glyph: "in" },
  x: { tone: "bg-black", glyph: "𝕏" },
  facebook: { tone: "bg-[#1877f2]", glyph: "f" },
};

function Share({ invite, where, meta, onClose, run }: { invite: InviteOut; where: string; meta: MetaOut; onClose: () => void; run: Run }) {
  const { org } = useSession();
  const { call } = useChatApi();
  const mail = useCompose();
  const toast = useToast();
  const [copied, setCopied] = useState<"link" | "text" | null>(null);
  const [qr, setQr] = useState(false);
  const [phone, setPhone] = useState("");
  const [emails, setEmails] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const text = inviteText({ inviter: meta.me.name, where, workspace: org.name, url: invite.url, approval: invite.approval });
  const subject = `${meta.me.name} invited you to chat in ${where}`;
  const targets = shareTargets({ url: invite.url, text, subject, phone });
  const svg = useMemo(() => (qr ? qrSvg(invite.url, { label: `Invite to ${where}` }) : ""), [qr, invite.url, where]);
  const addresses = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async (what: "link" | "text") => {
    if (await copyText(what === "link" ? invite.url : text)) {
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } else toast({ tone: "error", title: "Couldn't copy — select the link and copy it yourself" });
  };

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <div className="flex items-center gap-2 rounded-[14px] border border-border bg-surface-2/60 p-1.5 pl-3">
          <Link2 className="size-4 shrink-0 text-muted" />
          <input readOnly value={invite.url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none" />
          <Button size="sm" variant="primary" icon={copied === "link" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={() => void copy("link")}>{copied === "link" ? "Copied" : "Copy link"}</Button>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1">{invite.approval ? <><ShieldCheck className="size-3.5 text-emerald-600" />You approve each person</> : <><UserCheck className="size-3.5 text-amber-600" />Joins without approval</>}</span>
          <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" />{invite.expiresAt ? `Works until ${longWhen(invite.expiresAt)}` : "Never expires"}</span>
          <span>{invite.maxUses ? `${invite.uses} of ${invite.maxUses} used` : `${invite.uses} ${invite.uses === 1 ? "person" : "people"} used it`}</span>
          <span>{invite.history ? "Sees earlier messages" : "Sees new messages only"}</span>
        </p>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-medium">Share it</p>
        <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
          {targets.map((t) => <Tile key={t.id} href={t.href} newTab={t.newTab} label={t.label.replace(/^WhatsApp \+\d+$/, "WhatsApp")} tone={GLYPH[t.id]!.tone} glyph={GLYPH[t.id]!.glyph} />)}
          <Tile label={copied === "text" ? "Copied" : "Copy message"} tone="bg-zinc-500" glyph={copied === "text" ? <Check /> : <Copy />} onClick={() => void copy("text")} />
          <Tile label="QR code" tone="bg-zinc-800" glyph={<QrCode />} onClick={() => setQr((x) => !x)} />
          {mail.available && <Tile label="Cloudesk Mail" tone="bg-sky-600" glyph={<Mail />} onClick={() => { onClose(); mail.compose({ title: "Invite to chat", subject, body: text }); }} />}
          {canShare && <Tile label="More apps…" tone="bg-violet-600" glyph={<Share2 />} onClick={() => void navigator.share({ title: subject, text, url: invite.url }).catch(() => {})} />}
        </div>
      </div>

      {qr && (
        <div className="flex flex-wrap items-center gap-4 rounded-[14px] border border-border p-3.5">
          <div className="size-40 shrink-0 overflow-hidden rounded-[10px] bg-white p-1 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="grid gap-2 text-[13px]">
            <p className="text-muted">Scan with a phone camera to open the invite. Put it on a screen, a printout or a slide.</p>
            <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => download(svg, `invite-${where.replace(/[^\w-]+/g, "-")}.svg`)}>Download QR (SVG)</Button>
          </div>
        </div>
      )}

      <div className="grid gap-2 rounded-[14px] border border-border p-3.5">
        <p className="flex items-center gap-2 text-[13px] font-medium"><MessageCircle className="size-4 text-[#25d366]" />Send on WhatsApp to a number</p>
        <div className="flex gap-2">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" aria-label="WhatsApp number with country code" />
          <a href={targets[0]!.href} target="_blank" rel="noopener noreferrer" aria-disabled={phone.replace(/\D/g, "").length < 8} className={cx("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#25d366] px-4 text-[13px] font-semibold text-white hover:brightness-95", phone.replace(/\D/g, "").length < 8 && "pointer-events-none opacity-50")}><Send className="size-3.5" />Open WhatsApp</a>
        </div>
        <p className="text-[11.5px] text-muted">Include the country code. WhatsApp opens with the invite written out — you press send.</p>
      </div>

      <form
        className="grid gap-2 rounded-[14px] border border-border p-3.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!addresses.length) return;
          setSending(true);
          const ok = await run(() => call(`invites/${invite.id}/email`, "POST", { to: addresses, message: note }), `Invite emailed to ${addresses.length} ${addresses.length === 1 ? "person" : "people"}`);
          setSending(false);
          if (ok) {
            setEmails("");
            setNote("");
          }
        }}
      >
        <p className="flex items-center gap-2 text-[13px] font-medium"><Mail className="size-4 text-slate-500" />Email the invite from Cloudesk</p>
        <Input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@example.com, another@example.com" aria-label="Email addresses" type="text" inputMode="email" />
        <Textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Add a personal note (optional)" aria-label="Personal note" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11.5px] text-muted">One email each. Replies come to you.{invite.sent.length ? ` Sent ${invite.sent.length} so far.` : ""}</span>
          <Button type="submit" size="sm" variant="primary" loading={sending} disabled={!addresses.length} icon={<Send className="size-3.5" />}>Send{addresses.length > 1 ? ` (${addresses.length})` : ""}</Button>
        </div>
      </form>
    </div>
  );
}

function download(svg: string, filename: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Requests: let people in ────────────────────────────────────────────────

function Requests({ list, loading, run }: { list: GuestOut[]; loading: boolean; run: Run }) {
  const { call } = useChatApi();
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (loading) return <p className="py-8 text-center text-[13px] text-muted">Loading…</p>;
  if (!list.length) return <Empty icon={<UserCheck />} title="Nobody's waiting" sub="When someone opens an invite link and asks to join, they show up here — and you'll get a notification." />;
  return (
    <ul className="grid gap-2">
      {list.map((g) => (
        <li key={g.id} className="rounded-[14px] border border-border p-3">
          <div className="flex items-start gap-3">
            <Avatar id={g.userId} name={g.name} size={36} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">{g.name}</p>
              <p className="text-[12px] text-muted">{[g.contact, g.device, `asked ${shortWhen(g.createdAt)}`].filter(Boolean).join(" · ")}</p>
              {g.note && <p className="mt-1.5 rounded-[10px] bg-surface-2 px-2.5 py-1.5 text-[13px]">“{g.note}”</p>}
            </div>
          </div>
          {declining === g.id ? (
            <div className="mt-3 grid gap-2">
              <Input autoFocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional — they'll see it)" aria-label="Reason for declining" />
              <div className="flex gap-2">
                <Button size="sm" variant="danger" onClick={() => void run(() => call(`guests/${g.id}/decide`, "POST", { approve: false, reason }), `${g.name} wasn't let in`).then(() => { setDeclining(null); setReason(""); })}>Decline</Button>
                <Button size="sm" variant="ghost" onClick={() => setDeclining(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => void run(() => call(`guests/${g.id}/decide`, "POST", { approve: true }), `${g.name} is in`)}>Let in</Button>
              <Button size="sm" icon={<X className="size-3.5" />} onClick={() => setDeclining(g.id)}>Decline</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Guests: who's in, and who was ──────────────────────────────────────────

function GuestList({ list, people, run }: { list: GuestOut[]; people: Map<string, PersonOut>; run: Run }) {
  const { call } = useChatApi();
  const now = list.filter((g) => g.status === "approved");
  const before = list.filter((g) => g.status !== "approved" && g.status !== "pending");
  const name = (id: string | null) => (id ? (people.get(id)?.name ?? "an admin") : "the invite link");
  return (
    <div className="grid gap-5">
      {now.length ? (
        <ul className="grid gap-1">
          {now.map((g) => {
            const p = people.get(g.userId);
            return (
              <li key={g.id} className="flex items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-surface-2">
                <Avatar id={g.userId} name={g.name} person={p} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13.5px] font-medium">{g.name}<span className="rounded-full bg-teal-500/12 px-1.5 text-[10.5px] font-semibold text-teal-700 dark:text-teal-300">Guest</span></span>
                  <span className="block truncate text-[11.5px] text-muted">{[g.contact, `let in by ${name(g.decidedBy)}${g.decidedAt ? ` ${shortWhen(g.decidedAt)}` : ""}`, p?.online ? "online now" : g.lastSeenAt ? `last seen ${shortWhen(g.lastSeenAt)}` : "hasn't opened it yet", g.files ? "" : "no files"].filter(Boolean).join(" · ")}</span>
                </span>
                <Button size="sm" variant="ghost" icon={<UserMinus className="size-3.5" />} onClick={() => void run(() => call(`guests/${g.id}`, "DELETE"), `${g.name} was removed`)}>Remove</Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty icon={<Users />} title="No guests here yet" sub="Share an invite link — people join with just their name." />
      )}
      {before.length > 0 && (
        <div>
          <p className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">Earlier</p>
          <ul className="grid gap-1">
            {before.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-2 py-1.5 text-[13px]">
                <span className="grid size-7 place-items-center rounded-full bg-surface-2 text-muted"><UserX className="size-3.5" /></span>
                <span className="min-w-0 flex-1 truncate"><b className="font-medium">{g.name}</b> <span className="text-muted">· {GUEST_STATUS_LABEL[g.status]}{g.decidedAt ? ` ${shortWhen(g.decidedAt)}` : ""}{g.reason ? ` — “${g.reason}”` : ""}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Links: every invite, its use, and turning it off ───────────────────────

function Links({ list, run, onNew }: { list: InviteOut[]; run: Run; onNew: () => void }) {
  const { call } = useChatApi();
  const [copied, setCopied] = useState<string | null>(null);
  if (!list.length) return <Empty icon={<Link2 />} title="No invite links yet" sub="Make one on the Invite tab." action={<Button size="sm" variant="primary" onClick={onNew}>Make a link</Button>} />;
  return (
    <ul className="grid gap-2">
      {list.map((i) => (
        <li key={i.id} className={cx("rounded-[14px] border border-border p-3", i.problem && "opacity-70")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[13.5px] font-semibold">{i.label || "Invite link"}<span className={cx("rounded-full px-2 py-px text-[10.5px] font-semibold", i.problem ? "bg-surface-2 text-muted" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300")}>{i.revokedAt ? "Off" : i.problem ? "Ended" : "Active"}</span></span>
              <span className="block truncate font-mono text-[11.5px] text-muted">{i.url}</span>
            </span>
            {!i.problem && <Button size="sm" variant="ghost" icon={copied === i.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={() => void copyText(i.url).then((ok) => { if (ok) { setCopied(i.id); setTimeout(() => setCopied(null), 1500); } })}>{copied === i.id ? "Copied" : "Copy"}</Button>}
            {i.revokedAt ? <Button size="sm" onClick={() => void run(() => call(`invites/${i.id}`, "PATCH", { revoked: false }), "Link turned back on")}>Turn on</Button> : <Button size="sm" variant="danger" onClick={() => void run(() => call(`invites/${i.id}`, "PATCH", { revoked: true }), "Link turned off — guests already in stay")}>Turn off</Button>}
          </div>
          <p className="mt-1.5 text-[12px] text-muted">{summary(i)}{i.problem && !i.revokedAt ? ` · ${i.problem.replace(/^This invite link /, "").replace(/\.$/, "")}` : ""}</p>
          {!i.revokedAt && (
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2 text-[12.5px]">
              <label className="flex items-center gap-2"><Switch label="Approve each person" checked={i.approval} onChange={(on) => void run(() => call(`invites/${i.id}`, "PATCH", { approval: on }), "Saved")} />Approve each person</label>
              <label className="flex items-center gap-2"><Switch label="Earlier messages" checked={i.history} onChange={(on) => void run(() => call(`invites/${i.id}`, "PATCH", { history: on }), "Saved — applies to people who join from now")} />Earlier messages</label>
              <label className="flex items-center gap-2"><Switch label="Files" checked={i.files} onChange={(on) => void run(() => call(`invites/${i.id}`, "PATCH", { files: on }), "Saved — applies to people who join from now")} />Files</label>
            </div>
          )}
          {i.sent.length > 0 && <p className="mt-2 truncate text-[11.5px] text-subtle">Emailed to {i.sent.slice(-5).map((x) => x.to).join(", ")}{i.sent.length > 5 ? ` and ${i.sent.length - 5} more` : ""}</p>}
        </li>
      ))}
    </ul>
  );
}

function Empty({ icon, title, sub, action }: { icon: ReactNode; title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 px-4 py-8 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-muted [&>svg]:size-5">{icon}</span>
      <p className="text-[14px] font-semibold">{title}</p>
      <p className="max-w-sm text-[13px] text-muted">{sub}</p>
      {action}
    </div>
  );
}
