"use client";

// Chat's dialogs: new channel / new chat, channel settings and people, and the
// builders for interactive messages (poll, checklist, decision, approval,
// meeting), plus tasks, forwarding, reminders and your status.
import { useQuery } from "@tanstack/react-query";
import { Check, Crown, GripVertical, Hash, ImagePlus, Loader2, Lock, Plus, Search, Trash2, UserMinus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Select, Switch, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { ChannelOut, MessageOut, MetaOut, PersonOut } from "@/lib/chat/api";
import { CHANNEL_COLORS, parseWhen, STATUS_LABEL, STATUSES, type PostIn, type Status } from "@/lib/chat/model";
import { plain } from "@/lib/chat/text";
import { FindPeople } from "@/components/people/find-people";
import { Avatar, ConvIcon, channelTitle, chatKey, presenceOf, useChatApi } from "./shared";

const rid = () => Math.random().toString(36).slice(2, 10);
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function PeoplePicker({ people, value, onChange, exclude = [], max }: { people: PersonOut[]; value: string[]; onChange: (v: string[]) => void; exclude?: string[]; max?: number }) {
  const [q, setQ] = useState("");
  const list = people.filter((p) => !exclude.includes(p.id) && (!q || `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((u) => {
            const p = people.find((x) => x.id === u);
            return (
              <span key={u} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-1 pl-1 text-[12.5px]">
                <Avatar id={u} name={p?.name ?? "?"} size={20} />
                {p?.name ?? "Someone"}
                <button type="button" aria-label={`Remove ${p?.name}`} onClick={() => onChange(value.filter((x) => x !== u))} className="grid size-4 place-items-center rounded-full hover:bg-fg/10"><X className="size-3" /></button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find people" className="pl-8" aria-label="Find people" />
      </div>
      <ul className="max-h-60 overflow-y-auto rounded-[12px] border border-border p-1">
        {list.length === 0 && <li className="px-3 py-4 text-center text-[13px] text-muted">Nobody matches</li>}
        {list.map((p) => {
          const on = value.includes(p.id);
          return (
            <li key={p.id}>
              <button type="button" disabled={!on && !!max && value.length >= max} onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])} className={cx("flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-50", on && "bg-sky-500/8")}>
                <Avatar id={p.id} name={p.name} person={p} size={28} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{p.name}</span><span className="block truncate text-[11.5px] text-muted">{p.email} · {presenceOf(p).label}</span></span>
                <span className={cx("grid size-5 place-items-center rounded-full border", on ? "border-sky-600 bg-sky-600 text-white" : "border-fg/25")}>{on && <Check className="size-3" />}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NewChannelDialog({ meta, onClose, onDone }: { meta: MetaOut; onClose: () => void; onDone: (id: string) => void }) {
  const { call } = useChatApi();
  const toast = useToast();
  const [v, setV] = useState({ name: "", topic: "", description: "", visibility: "public" as "public" | "private", emoji: "", color: CHANNEL_COLORS[0]!, posting: "everyone" as "everyone" | "admins", members: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const slug = v.name.trim().toLowerCase().replace(/\s+/g, "-");
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ channel: { id: string } }>("channels", "POST", v);
      toast({ tone: "success", title: `#${slug} is ready` });
      onDone(r.channel.id);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="md" title="New channel" description="A place for a team, a project or a topic. Public channels can be found and joined by anyone in the workspace." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!slug} onClick={() => void go()}>Create channel</Button></>}>
      <div className="grid gap-4">
        <Field label="Name" error={err ?? undefined} hint={slug ? `#${slug}` : "Lower case, no spaces — like #sales or #taj-rollout"}>
          {(p) => (
            <div className="flex gap-2">
              <Input {...p} value={v.emoji} onChange={(e) => setV({ ...v, emoji: [...e.target.value].slice(-2).join("") })} placeholder="😀" aria-label="Emoji" className="w-14 text-center" />
              <Input {...p} autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. sales" maxLength={60} />
            </div>
          )}
        </Field>
        <Field label="Topic" hint="One line shown at the top of the channel">{(p) => <Input {...p} value={v.topic} onChange={(e) => setV({ ...v, topic: e.target.value })} placeholder="What's this channel for?" maxLength={250} />}</Field>
        <div className="grid gap-2">
          <p className="text-[13px] font-medium">Who can see it</p>
          <div className="grid grid-cols-2 gap-2">
            {(["public", "private"] as const).map((x) => (
              <button key={x} type="button" onClick={() => setV({ ...v, visibility: x })} className={cx("flex items-start gap-2.5 rounded-[14px] border p-3 text-left", v.visibility === x ? "border-sky-500 bg-sky-500/5" : "border-border hover:bg-surface-2")}>
                {x === "public" ? <Hash className="mt-0.5 size-4 shrink-0" /> : <Lock className="mt-0.5 size-4 shrink-0" />}
                <span><span className="block text-[13.5px] font-semibold">{x === "public" ? "Public" : "Private"}</span><span className="block text-[12px] text-muted">{x === "public" ? "Anyone in the workspace can find and join" : "Only people you add can see it"}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-medium">Colour</span>
          {CHANNEL_COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setV({ ...v, color: c })} className={cx("size-6 rounded-full ring-offset-2 ring-offset-[var(--surface-solid)]", v.color === c && "ring-2 ring-fg")} style={{ background: c }} />)}
        </div>
        <label className="flex items-center gap-2 text-[13px]"><Switch label="Only admins post" checked={v.posting === "admins"} onChange={(on) => setV({ ...v, posting: on ? "admins" : "everyone" })} /> Only admins can post (an announcements channel)</label>
        <div className="grid gap-2">
          <p className="text-[13px] font-medium">Add people <span className="font-normal text-muted">(optional)</span></p>
          <PeoplePicker people={meta.people} value={v.members} onChange={(members) => setV({ ...v, members })} exclude={[meta.me.id]} />
        </div>
      </div>
    </Dialog>
  );
}

export function NewChatDialog({ meta, onClose, onDone }: { meta: MetaOut; onClose: () => void; onDone: (id: string) => void }) {
  const { call } = useChatApi();
  const toast = useToast();
  const [users, setUsers] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = users.length === 1 && !name ? await call<{ channel: { id: string } }>(`dm/${users[0]}`, "POST") : await call<{ channel: { id: string } }>("groups", "POST", { users, name });
      onDone(r.channel.id);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="md" title="New chat" description="One person for a direct message; more for a group chat." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!users.length} onClick={() => void go()}>{users.length > 1 ? "Start group chat" : "Open chat"}</Button></>}>
      <div className="grid gap-4">
        <PeoplePicker people={meta.people} value={users} onChange={setUsers} exclude={[meta.me.id]} max={49} />
        {users.length > 1 && <Field label="Group name (optional)">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Launch crew" maxLength={60} />}</Field>}
      </div>
    </Dialog>
  );
}

export function ChannelSettings({ c, meta, onClose, onChanged, onLeft }: { c: ChannelOut; meta: MetaOut; onClose: () => void; onChanged: () => void; onLeft: () => void }) {
  const { call, orgId } = useChatApi();
  const toast = useToast();
  const people = useMemo(() => new Map([...meta.guests, ...meta.people].map((p) => [p.id, p])), [meta.guests, meta.people]);
  const [tab, setTab] = useState<"about" | "people" | "settings">(c.kind === "dm" ? "settings" : "about");
  const [v, setV] = useState({ name: c.name, topic: c.topic, description: c.description, emoji: c.emoji, color: c.color, posting: c.posting, ai: c.ai, visibility: c.visibility });
  const [adding, setAdding] = useState<string[]>([]);
  const mem = useQuery({ queryKey: chatKey(orgId, "members", c.id), queryFn: () => call<{ members: { userId: string; role: string }[] }>(`channels/${c.id}/members`) });
  const admin = c.role === "owner" || c.role === "admin" || meta.me.admin;
  const run = async (f: () => Promise<unknown>, ok?: string) => {
    try {
      await f();
      if (ok) toast({ tone: "success", title: ok });
      void mem.refetch();
      onChanged();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const title = c.kind === "channel" ? `#${c.name}` : channelTitle(c, people);
  return (
    <Dialog open onClose={onClose} size="lg" title={title} description={c.kind === "channel" ? `${c.visibility === "private" ? "Private" : "Public"} channel · ${c.memberCount} ${c.memberCount === 1 ? "member" : "members"}` : undefined}>
      <div className="mb-4 flex gap-1" role="tablist">
        {(c.kind === "dm" ? (["settings"] as const) : (["about", "people", "settings"] as const)).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("h-8 rounded-full px-3 text-[13px] capitalize", tab === t ? "bg-fg font-medium text-bg" : "text-muted hover:bg-surface-2")}>{t === "people" ? `People (${c.memberCount})` : t}</button>
        ))}
      </div>
      {tab === "about" && (
        <div className="grid gap-4">
          <ChannelPicture c={c} admin={admin} people={people} onChanged={onChanged} />
          <Field label="Name">{(p) => <Input {...p} value={v.name} disabled={!admin} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={60} />}</Field>
          <Field label="Topic">{(p) => <Input {...p} value={v.topic} disabled={!admin && c.kind === "channel"} onChange={(e) => setV({ ...v, topic: e.target.value })} maxLength={250} />}</Field>
          <Field label="Description">{(p) => <Textarea {...p} rows={3} value={v.description} disabled={!admin && c.kind === "channel"} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={1000} />}</Field>
          {c.kind === "channel" && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] font-medium">Colour</span>
              {CHANNEL_COLORS.map((x) => <button key={x} type="button" disabled={!admin} aria-label={x} onClick={() => setV({ ...v, color: x })} className={cx("size-6 rounded-full ring-offset-2 ring-offset-[var(--surface-solid)]", v.color === x && "ring-2 ring-fg")} style={{ background: x }} />)}
            </div>
          )}
          {(admin || c.kind === "group") && <div><Button variant="primary" onClick={() => void run(() => call(`channels/${c.id}`, "PATCH", { name: v.name || undefined, topic: v.topic, description: v.description, color: v.color }), "Saved")}>Save</Button></div>}
        </div>
      )}
      {tab === "people" && (
        <div className="grid gap-4">
          <ul className="grid gap-1">
            {(mem.data?.members ?? []).map((m) => {
              const p = people.get(m.userId);
              return (
                <li key={m.userId} className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-surface-2">
                  <Avatar id={m.userId} name={p?.name ?? "?"} person={p} size={30} />
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-[13.5px] font-medium">{p?.name ?? "Former member"}{m.role === "owner" && <Crown className="size-3.5 text-amber-500" />}{m.role === "admin" && <span className="rounded-full bg-surface-2 px-1.5 text-[10.5px] font-semibold text-muted">Admin</span>}{m.role === "guest" && <span className="rounded-full bg-teal-500/12 px-1.5 text-[10.5px] font-semibold text-teal-700 dark:text-teal-300">Guest</span>}</span><span className="block truncate text-[11.5px] text-muted">{p ? `${presenceOf(p).label}${p.note ? ` · ${p.emoji} ${p.note}` : ""}` : ""}</span></span>
                  {admin && m.role === "guest" && <Button size="sm" variant="ghost" icon={<UserMinus className="size-3.5" />} onClick={() => void run(() => call(`channels/${c.id}/members/${m.userId}`, "DELETE"), "Removed")}>Remove</Button>}
                  {admin && m.role !== "owner" && m.role !== "guest" && m.userId !== meta.me.id && c.kind !== "dm" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => void run(() => call(`channels/${c.id}/members/${m.userId}`, "PATCH", { role: m.role === "admin" ? "member" : "admin" }))}>{m.role === "admin" ? "Make member" : "Make admin"}</Button>
                      <Button size="sm" variant="ghost" icon={<UserMinus className="size-3.5" />} onClick={() => void run(() => call(`channels/${c.id}/members/${m.userId}`, "DELETE"), "Removed")}>Remove</Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {c.member && (
            <div className="grid gap-2 border-t border-border pt-4">
              <p className="text-[13px] font-medium">Add people</p>
              <PeoplePicker people={meta.people} value={adding} onChange={setAdding} exclude={(mem.data?.members ?? []).map((m) => m.userId)} />
              <div><Button variant="primary" disabled={!adding.length} onClick={() => void run(async () => { await call(`channels/${c.id}/members`, "POST", { users: adding }); setAdding([]); }, "Added")}>Add {adding.length || ""}</Button></div>
            </div>
          )}
          {c.member && c.kind !== "dm" && (
            <div className="grid gap-2 border-t border-border pt-4">
              <p className="text-[13px] font-medium">Invite anyone</p>
              <p className="text-[12px] text-muted">Search a Cloudesk username, an email, a phone number or one of your contacts. People in this workspace join straight away; anyone else gets an email with a guest link to this conversation.</p>
              <FindPeople
                orgId={orgId}
                exclude={(mem.data?.members ?? []).map((m) => m.userId)}
                onPick={(h) =>
                  void run(async () => {
                    const r = await call<{ added: number; sent: number; label: string }>(`channels/${c.id}/invite-person`, "POST", h.kind === "account" ? { userId: h.id } : { email: h.email });
                    toast({ tone: "success", title: r.added ? `${h.kind === "account" ? h.name : "They"} joined` : `Invite sent${r.label ? ` to ${r.label}` : ""}`, description: r.added ? undefined : "They'll get an email with a link to join as a guest." });
                  })
                }
              />
            </div>
          )}
        </div>
      )}
      {tab === "settings" && (
        <div className="grid gap-4">
          {c.member && (
            <Field label="Notify me about">
              {(p) => (
                <Select {...p} value={c.notify} onChange={(e) => void run(() => call(`channels/${c.id}/prefs`, "PATCH", { notify: e.target.value }), "Saved")}>
                  <option value="all">{c.kind === "channel" ? "Every message" : "Every message (recommended)"}</option>
                  <option value="mentions">Only when I&apos;m mentioned</option>
                  <option value="none">Nothing (muted)</option>
                </Select>
              )}
            </Field>
          )}
          {c.kind === "channel" && admin && (
            <>
              <label className="flex items-center gap-2 text-[13px]"><Switch label="Only admins post" checked={v.posting === "admins"} onChange={(on) => { setV({ ...v, posting: on ? "admins" : "everyone" }); void run(() => call(`channels/${c.id}`, "PATCH", { posting: on ? "admins" : "everyone" }), "Saved"); }} /> Only admins can post</label>
              <label className="flex items-center gap-2 text-[13px]"><Switch label="Private" checked={v.visibility === "private"} onChange={(on) => { setV({ ...v, visibility: on ? "private" : "public" }); void run(() => call(`channels/${c.id}`, "PATCH", { visibility: on ? "private" : "public" }), "Saved"); }} /> Private channel (only members can find it)</label>
            </>
          )}
          {(admin || c.kind !== "channel") && <label className="flex items-center gap-2 text-[13px]"><Switch label="AI" checked={v.ai} onChange={(on) => { setV({ ...v, ai: on }); void run(() => call(`channels/${c.id}`, "PATCH", { ai: on }), "Saved"); }} /> AI catch-up and questions in this conversation</label>}
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <a href={`/api/v1/orgs/${orgId}/chat/channels/${c.id}/export`} className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">Export conversation (CSV)</a>
            {c.kind === "channel" && admin && <Button size="sm" onClick={() => void run(() => call(`channels/${c.id}`, "PATCH", { archived: !c.archived }), c.archived ? "Brought back" : "Archived")}>{c.archived ? "Unarchive" : "Archive channel"}</Button>}
            {c.member && c.kind !== "dm" && <Button size="sm" variant="danger" onClick={() => void run(async () => { await call(`channels/${c.id}/leave`, "POST"); onLeft(); }, "You left")}>Leave</Button>}
            {c.kind === "dm" && <Button size="sm" onClick={() => void run(async () => { await call(`channels/${c.id}/prefs`, "PATCH", { hidden: true }); onLeft(); }, "Hidden — it comes back when someone writes")}>Hide this chat</Button>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ── Builders ────────────────────────────────────────────────────────────────

type Send = (p: PostIn) => Promise<boolean>;

function OptionList({ items, onChange, placeholder, min }: { items: { id: string; label: string }[]; onChange: (v: { id: string; label: string }[]) => void; placeholder: (i: number) => string; min: number }) {
  return (
    <div className="grid gap-1.5">
      {items.map((o, i) => (
        <div key={o.id} className="flex items-center gap-1.5">
          <GripVertical className="size-4 shrink-0 text-subtle" />
          <Input value={o.label} onChange={(e) => onChange(items.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)))} placeholder={placeholder(i)} aria-label={placeholder(i)} maxLength={200} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onChange([...items, { id: rid(), label: "" }]); } }} />
          <button type="button" aria-label="Remove" disabled={items.length <= min} onClick={() => onChange(items.filter((x) => x.id !== o.id))} className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-30"><Trash2 className="size-3.5" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { id: rid(), label: "" }])} className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-[13px] font-medium text-sky-700 hover:bg-sky-500/10 dark:text-sky-400"><Plus className="size-3.5" />Add another</button>
    </div>
  );
}

export function PollDialog({ init, onClose, send }: { init?: { question?: string; options?: string[] }; onClose: () => void; send: Send }) {
  const [q, setQ] = useState(init?.question ?? "");
  const [opts, setOpts] = useState(() => (init?.options?.length ? init.options : ["", ""]).map((label) => ({ id: rid(), label })));
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnon] = useState(false);
  const [closes, setCloses] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = q.trim() && opts.filter((o) => o.label.trim()).length >= 2;
  return (
    <Dialog open onClose={onClose} size="md" title="Poll" description="Everyone in the conversation can vote; results update live." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={async () => { setBusy(true); if (await send({ poll: { question: q, options: opts.filter((o) => o.label.trim()), multi, anonymous, closesAt: closes ? new Date(closes).toISOString() : null } })) onClose(); setBusy(false); }}>Post poll</Button></>}>
      <div className="grid gap-4">
        <Field label="Question">{(p) => <Input {...p} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Which day works for the offsite?" maxLength={300} />}</Field>
        <div className="grid gap-1.5"><p className="text-[13px] font-medium">Choices</p><OptionList items={opts} onChange={setOpts} placeholder={(i) => `Choice ${i + 1}`} min={2} /></div>
        <label className="flex items-center gap-2 text-[13px]"><Switch label="Multiple" checked={multi} onChange={setMulti} /> People can pick more than one</label>
        <label className="flex items-center gap-2 text-[13px]"><Switch label="Anonymous" checked={anonymous} onChange={setAnon} /> Anonymous — show counts, not names</label>
        <Field label="Closes (optional)">{(p) => <Input {...p} type="datetime-local" value={closes} min={localInput(new Date())} onChange={(e) => setCloses(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

export function ChecklistDialog({ init, onClose, send }: { init?: { title?: string; items?: string[] }; onClose: () => void; send: Send }) {
  const [title, setTitle] = useState(init?.title ?? "");
  const [items, setItems] = useState(() => (init?.items?.length ? init.items : [""]).map((label) => ({ id: rid(), label })));
  const [busy, setBusy] = useState(false);
  const valid = title.trim() && items.some((i) => i.label.trim());
  return (
    <Dialog open onClose={onClose} size="md" title="Shared checklist" description="Anyone here can tick items off — everyone sees who did." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={async () => { setBusy(true); if (await send({ checklist: { title, items: items.filter((i) => i.label.trim()) } })) onClose(); setBusy(false); }}>Post checklist</Button></>}>
      <div className="grid gap-4">
        <Field label="Title">{(p) => <Input {...p} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Before the Taj launch" maxLength={200} />}</Field>
        <div className="grid gap-1.5"><p className="text-[13px] font-medium">Items</p><OptionList items={items} onChange={setItems} placeholder={(i) => `Item ${i + 1}`} min={1} /></div>
      </div>
    </Dialog>
  );
}

export function DecisionDialog({ init, onClose, send }: { init?: string; onClose: () => void; send: Send }) {
  const [text, setText] = useState(init ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} size="md" title="Propose a decision" description="People agree or object (with a reason). You settle it when it's clear — it's then kept in the channel's Decisions." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!text.trim()} onClick={async () => { setBusy(true); if (await send({ decision: { text } })) onClose(); setBusy(false); }}>Propose</Button></>}>
      <Field label="What's being decided">{(p) => <Textarea {...p} autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. We move hotel clients to net-30 payment terms from November." maxLength={1000} />}</Field>
    </Dialog>
  );
}

export function ApprovalDialog({ init, channelPeople, people, onClose, send }: { init?: string; channelPeople: string[]; people: PersonOut[]; onClose: () => void; send: Send }) {
  const [title, setTitle] = useState(init ?? "");
  const [details, setDetails] = useState("");
  const [amount, setAmount] = useState("");
  const [approvers, setApprovers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} size="md" title="Ask for approval" description="The approvers get a notification (and an email). Their answer, and any reason, stays with the request." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!title.trim() || !approvers.length} onClick={async () => { setBusy(true); if (await send({ approval: { title, details, amount, approvers } })) onClose(); setBusy(false); }}>Send request</Button></>}>
      <div className="grid gap-4">
        <Field label="What needs approving">{(p) => <Input {...p} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 12% discount for Taj Hotels" maxLength={300} />}</Field>
        <Field label="Amount (optional)">{(p) => <Input {...p} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹42,000" maxLength={40} />}</Field>
        <Field label="Details (optional)">{(p) => <Textarea {...p} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} />}</Field>
        <div className="grid gap-1.5"><p className="text-[13px] font-medium">Approvers <span className="font-normal text-muted">(people in this conversation)</span></p><PeoplePicker people={people.filter((p) => channelPeople.includes(p.id))} value={approvers} onChange={setApprovers} max={10} /></div>
      </div>
    </Dialog>
  );
}

export function MeetingDialog({ init, onClose, send }: { init?: string; onClose: () => void; send: Send }) {
  const [title, setTitle] = useState(init ?? "");
  // Next half hour, an hour from now.
  const [start, setStart] = useState(() => {
    const d = new Date(Date.now() + 3_600_000);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    return localInput(d);
  });
  const [mins, setMins] = useState(30);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} size="md" title="Schedule a meeting" description="Posts a meeting card; everyone can add it to their own calendar in one click." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!title.trim() || !start} onClick={async () => { setBusy(true); const s = new Date(start); if (await send({ event: { title, start: s.toISOString(), end: new Date(s.getTime() + mins * 60_000).toISOString(), meetingUrl: url } })) onClose(); setBusy(false); }}>Post meeting</Button></>}>
      <div className="grid gap-4">
        <Field label="Title">{(p) => <Input {...p} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pricing review" maxLength={200} />}</Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Starts">{(p) => <Input {...p} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="Length">{(p) => <Select {...p} value={mins} onChange={(e) => setMins(Number(e.target.value))}>{[15, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} h`}</option>)}</Select>}</Field>
        </div>
        <Field label="Meeting link (optional)" hint="Google Meet, Zoom, Teams — paste it here">{(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />}</Field>
      </div>
    </Dialog>
  );
}

export function TaskDialog({ m, init, people, onClose }: { m: MessageOut | null; init?: { title: string; owner?: string; due?: string }[]; people: PersonOut[]; onClose: () => void }) {
  const { call, orgId } = useChatApi();
  const toast = useToast();
  const targets = useQuery({ queryKey: chatKey(orgId, "task-targets"), queryFn: () => call<{ projects: { id: string; name: string; code: string }[]; available: boolean }>("tasks/targets") });
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState(() =>
    (init?.length ? init : [{ title: m ? plain(m.body).split("\n")[0]!.slice(0, 200) : "" }]).map((r) => ({ id: rid(), title: r.title, assigneeId: people.find((p) => r.owner && p.name.toLowerCase() === r.owner.toLowerCase())?.id ?? "", due: /^\d{4}-\d{2}-\d{2}$/.test(r.due ?? "") ? r.due! : "" })),
  );
  const [busy, setBusy] = useState(false);
  const pid = projectId || targets.data?.projects[0]?.id || "";
  const go = async () => {
    setBusy(true);
    try {
      const r = await call<{ tasks: unknown[] }>("tasks", "POST", { projectId: pid, messageId: m?.id ?? null, items: rows.filter((x) => x.title.trim()).map((x) => ({ title: x.title, assigneeId: x.assigneeId || null, dueDate: x.due || null })) });
      toast({ tone: "success", title: r.tasks.length === 1 ? "Task made" : `${r.tasks.length} tasks made`, description: "In Projects — the thread says so too." });
      onClose();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="lg" title={rows.length > 1 ? "Make tasks" : "Make a task"} description="Into a project in Projects & timesheets — assigned people are told." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!pid || !rows.some((r) => r.title.trim())} onClick={() => void go()}>Make {rows.filter((r) => r.title.trim()).length > 1 ? `${rows.filter((r) => r.title.trim()).length} tasks` : "task"}</Button></>}>
      {targets.data && !targets.data.available ? (
        <p className="text-[13.5px] text-muted">Tasks live in Projects & timesheets — it isn&apos;t on in this workspace, or your role can&apos;t plan work.</p>
      ) : targets.data && !targets.data.projects.length ? (
        <p className="text-[13.5px] text-muted">There are no open projects yet. Make one in Projects first.</p>
      ) : (
        <div className="grid gap-4">
          <Field label="Project">{(p) => <Select {...p} value={pid} onChange={(e) => setProjectId(e.target.value)}>{(targets.data?.projects ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select>}</Field>
          <div className="grid gap-2">
            {rows.map((r) => (
              <div key={r.id} className="grid gap-1.5 rounded-[12px] border border-border p-2 sm:grid-cols-[1fr_160px_140px_auto]">
                <Input value={r.title} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, title: e.target.value } : x)))} placeholder="What needs doing" aria-label="Task" maxLength={300} />
                <Select value={r.assigneeId} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, assigneeId: e.target.value } : x)))} aria-label="Assignee"><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                <Input type="date" value={r.due} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, due: e.target.value } : x)))} aria-label="Due" />
                {rows.length > 1 && <button type="button" aria-label="Remove" onClick={() => setRows(rows.filter((x) => x.id !== r.id))} className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2"><Trash2 className="size-3.5" /></button>}
              </div>
            ))}
            {!init && <button type="button" onClick={() => setRows([...rows, { id: rid(), title: "", assigneeId: "", due: "" }])} className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-[13px] font-medium text-sky-700 hover:bg-sky-500/10 dark:text-sky-400"><Plus className="size-3.5" />Another task</button>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function ForwardDialog({ m, meta, onClose, onDone }: { m: MessageOut; meta: MetaOut; onClose: () => void; onDone: (channelId: string) => void }) {
  const { call } = useChatApi();
  const toast = useToast();
  const people = useMemo(() => new Map(meta.people.map((p) => [p.id, p])), [meta.people]);
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const list = meta.channels.filter((c) => c.member && !c.archived && channelTitle(c, people).toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open onClose={onClose} size="md" title="Forward message" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!to} onClick={async () => { setBusy(true); try { await call(`messages/${m.id}/forward`, "POST", { to, comment }); toast({ tone: "success", title: "Forwarded" }); onDone(to); } catch (e) { toast({ tone: "error", title: errorMessage(e) }); } finally { setBusy(false); } }}>Forward</Button></>}>
      <div className="grid gap-3">
        <blockquote className="rounded-[12px] border-l-[3px] border-border bg-surface-2/60 px-3 py-2 text-[13px] text-muted">{plain(m.body).slice(0, 300) || `[${m.kind}]`}</blockquote>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a channel or chat" aria-label="Find a conversation" />
        <ul className="max-h-56 overflow-y-auto rounded-[12px] border border-border p-1">
          {list.map((c) => (
            <li key={c.id}><button type="button" onClick={() => setTo(c.id)} className={cx("flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-[13.5px] hover:bg-surface-2", to === c.id && "bg-sky-500/10 font-medium")}>{c.kind === "channel" ? <Hash className="size-3.5 text-muted" /> : <Avatar id={c.people[0] ?? c.id} name={channelTitle(c, people)} size={20} />}{channelTitle(c, people)}{to === c.id && <Check className="ml-auto size-4 text-sky-600" />}</button></li>
          ))}
        </ul>
        <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note (optional)" aria-label="Note" />
      </div>
    </Dialog>
  );
}

export function RemindDialog({ m, onClose, onDone }: { m: MessageOut; onClose: () => void; onDone: () => void }) {
  const { call } = useChatApi();
  const toast = useToast();
  const [custom, setCustom] = useState("");
  const set = async (d: Date | null) => {
    if (!d) return toast({ tone: "error", title: "Try “in 2h”, “tomorrow 9am” or “friday”" });
    try {
      await call(`messages/${m.id}/save`, "POST", { remindAt: d.toISOString() });
      toast({ tone: "success", title: `I'll remind you ${d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` });
      onDone();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const quick: [string, string][] = [["In 20 minutes", "in 20m"], ["In 1 hour", "in 1h"], ["In 3 hours", "in 3h"], ["Tomorrow morning", "tomorrow 9am"], ["Next Monday", "monday 9am"]];
  return (
    <Dialog open onClose={onClose} size="sm" title="Remind me about this">
      <div className="grid gap-1.5">
        {quick.map(([l, w]) => <button key={l} type="button" onClick={() => void set(parseWhen(w))} className="rounded-[10px] px-3 py-2 text-left text-[13.5px] hover:bg-surface-2">{l}</button>)}
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void set(parseWhen(custom)); }}>
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. in 45m, friday 4pm" aria-label="When" />
          <Button type="submit" variant="primary">Set</Button>
        </form>
      </div>
    </Dialog>
  );
}

export function StatusDialog({ meta, onClose, onDone }: { meta: MetaOut; onClose: () => void; onDone: () => void }) {
  const { call } = useChatApi();
  const toast = useToast();
  const [status, setStatus] = useState<Status>(meta.me.status);
  const [note, setNote] = useState(meta.me.note);
  const [emoji, setEmoji] = useState(meta.me.emoji);
  const [clear, setClear] = useState("never");
  const presets: [string, string, Status][] = [["📅", "In a meeting", "busy"], ["🚗", "Commuting", "away"], ["🤒", "Out sick", "away"], ["🌴", "On leave", "away"], ["🎧", "Focusing", "dnd"], ["🏠", "Working from home", "available"]];
  const go = async () => {
    const until = clear === "never" ? null : clear === "today" ? (() => { const d = new Date(); d.setHours(23, 59, 0, 0); return d.toISOString(); })() : new Date(Date.now() + Number(clear) * 60_000).toISOString();
    try {
      await call("presence", "POST", { status, note, emoji, until });
      onDone();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title="Your status" description="Do not disturb holds every notification except urgent messages." footer={<><Button onClick={() => { setStatus("available"); setNote(""); setEmoji(""); }}>Clear</Button><Button variant="primary" onClick={() => void go()}>Save</Button></>}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-1.5">
          {STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className={cx("flex items-center gap-2 rounded-[11px] border px-3 py-2 text-[13px]", status === s ? "border-sky-500 bg-sky-500/5 font-medium" : "border-border hover:bg-surface-2")}>
              <span className={cx("size-2.5 rounded-full", presenceOf({ status: s, online: true, inMeeting: null }).tone)} />{STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={emoji} onChange={(e) => setEmoji([...e.target.value].slice(-2).join(""))} placeholder="🙂" className="w-14 text-center" aria-label="Status emoji" />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's your status?" maxLength={100} aria-label="Status note" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map(([e, n, s]) => <button key={n} type="button" onClick={() => { setEmoji(e); setNote(n); setStatus(s); }} className="rounded-full border border-border px-2.5 py-1 text-[12.5px] hover:bg-surface-2">{e} {n}</button>)}
        </div>
        <Field label="Clear after">{(p) => <Select {...p} value={clear} onChange={(e) => setClear(e.target.value)}><option value="never">Don&apos;t clear</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="today">Today</option></Select>}</Field>
      </div>
    </Dialog>
  );
}

/** A group's or channel's picture: its admins upload one (cropped square in the browser) or remove it. */
function ChannelPicture({ c, admin, people, onChanged }: { c: ChannelOut; admin: boolean; people: Map<string, PersonOut>; onChanged: () => void }) {
  const { base, call } = useChatApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(c.avatar);
  const pick = async (file: File) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast({ tone: "error", title: "Use a PNG, JPG, GIF or WebP image" });
    if (file.size > 15 * 1024 * 1024) return toast({ tone: "error", title: "That image is over 15 MB" });
    setBusy(true);
    try {
      const square = await squareImage(file, 512);
      const res = await fetch(`${base}/channels/${c.id}/files?name=${encodeURIComponent("picture.jpg")}`, { method: "POST", headers: { "Content-Type": square.type }, body: square });
      const up = (await res.json()) as { file?: { id: string }; error?: { message?: string } };
      if (!res.ok || !up.file) throw new Error(up.error?.message ?? "Couldn't upload the picture");
      await call(`channels/${c.id}`, "PATCH", { avatarFileId: up.file.id });
      setShown(up.file.id);
      toast({ tone: "success", title: c.kind === "group" ? "Group picture updated" : "Channel picture updated" });
      onChanged();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await call(`channels/${c.id}`, "PATCH", { avatarFileId: null });
      setShown(null);
      onChanged();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-4">
      <span className="relative">
        <ConvIcon c={{ ...c, avatar: shown }} people={people} size={72} />
        {busy && <span className="absolute inset-0 grid place-items-center rounded-[22px] bg-black/35 text-white"><Loader2 className="size-5 animate-spin" /></span>}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{c.kind === "group" ? "Group picture" : "Channel picture"}</p>
        {admin ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <label className={cx("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 text-[12.5px] font-medium hover:bg-surface-2", busy && "pointer-events-none opacity-50")}>
              <ImagePlus className="size-3.5" />{shown ? "Change picture" : "Add a picture"}
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
            </label>
            {shown && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>Remove</Button>}
          </div>
        ) : (
          <p className="mt-0.5 text-[12px] text-muted">Its admins can change it.</p>
        )}
      </div>
    </div>
  );
}

/** Crops an image to its centre square and scales it to `size` px, as a JPEG. */
async function squareImage(file: File, size: number): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(size, side);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  img.close();
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't read that image"))), "image/jpeg", 0.88));
}
