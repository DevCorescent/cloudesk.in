"use client";

// The address book: the workspace's contacts and groups. Find anyone, email a
// person, a selection or a whole group in one click (together, or separately
// to each), keep groups (Suppliers, Distributors, Board…), favourites and tags,
// and import or export the lot as a spreadsheet.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Mail, MoreHorizontal, Pencil, Plus, Search, Star, Trash2, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import type { ImportResult } from "@/components/import/smart-import";
import { ConfirmDialog, Dialog, Menu, useToast } from "@/components/ui/overlays";
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import type { ContactOut, ContactsOut, GroupOut } from "@/lib/mail/api";
import { useCompose } from "./compose-provider";
import { Avatar, mailKey, shortTime, useMailApi } from "./shared";

const COLORS = ["#2563eb", "#0f766e", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#475569"];

export function MailContacts() {
  const { orgId, call } = useMailApi();
  const qc = useQueryClient();
  const toast = useToast();
  const { compose } = useCompose();
  const [text, setText] = useState("");
  const [find, setFind] = useState("");
  const [group, setGroup] = useState<string | "fav" | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<ContactOut | "new" | null>(null);
  const [groupEdit, setGroupEdit] = useState<GroupOut | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "contacts"; ids: string[] } | { kind: "group"; g: GroupOut } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setFind(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  const params = new URLSearchParams({ ...(find ? { q: find } : {}), ...(group === "fav" ? { favorites: "1" } : group ? { group } : {}) });
  const q = useQuery({ queryKey: mailKey(orgId, "contacts", params.toString()), queryFn: () => call<ContactsOut>(`contacts?${params.toString()}`), placeholderData: (p) => p });
  const reload = () => void qc.invalidateQueries({ queryKey: mailKey(orgId, "contacts") });
  const d = q.data;
  const rows = d?.contacts ?? [];
  const groupOf = useMemo(() => new Map((d?.groups ?? []).map((g) => [g.id, g])), [d]);
  const current = group && group !== "fav" ? groupOf.get(group) : null;
  const picked = rows.filter((r) => selected.has(r.id));

  const bulk = async (action: "addToGroup" | "removeFromGroup" | "favorite" | "unfavorite" | "delete", groupId?: string) => {
    try {
      const r = await call<{ count: number }>("contacts/bulk", "POST", { ids: [...selected], action, groupId });
      toast({ tone: "success", title: action === "delete" ? `Deleted ${r.count}` : action === "addToGroup" ? `Added ${r.count} to ${groupOf.get(groupId!)?.name}` : action === "removeFromGroup" ? `Removed ${r.count} from the group` : "Done" });
      setSelected(new Set());
      reload();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const star = async (c: ContactOut) => {
    try {
      await call(`contacts/${c.id}`, "PUT", { ...c, favorite: !c.favorite });
      reload();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const emailGroup = (g: GroupOut) => compose({ groups: [{ id: g.id, name: g.name, count: g.count, color: g.color }], title: `Email ${g.name}` });

  const side = (
    <nav aria-label="Groups" className="grid content-start gap-0.5">
      <SideItem active={group === null} onClick={() => setGroup(null)} icon={<Users className="size-4" />} label="All contacts" count={d?.total} />
      <SideItem active={group === "fav"} onClick={() => setGroup("fav")} icon={<Star className="size-4" />} label="Favourites" />
      <p className="mt-4 flex items-center justify-between px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.12em] text-subtle uppercase">Groups <button type="button" aria-label="New group" onClick={() => setGroupEdit("new")} className="grid size-5 place-items-center rounded-full normal-case hover:bg-surface-2 hover:text-fg"><Plus className="size-3.5" /></button></p>
      {(d?.groups ?? []).map((g) => <SideItem key={g.id} active={group === g.id} onClick={() => setGroup(g.id)} icon={<span className="size-2.5 rounded-full" style={{ background: g.color }} />} label={g.name} count={g.count} />)}
      {d && !d.groups.length && <button type="button" onClick={() => setGroupEdit("new")} className="rounded-[10px] px-2.5 py-1.5 text-left text-[12.5px] text-muted hover:bg-surface-2">+ Make a group (e.g. Suppliers)</button>}
    </nav>
  );

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
      <Link href="/mail" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Back to mail</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Contacts</h1>
          <p className="mt-0.5 text-[13px] text-muted">Your team&apos;s address book. Pick people or whole groups when you write — from Mail or anywhere in Cloudesk.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportButton target={target("mail.contacts")} onImport={(rows, mode) => call<ImportResult>("contacts/import", "POST", { rows, mode })} onDone={reload} />
          <ExportMenu name="contacts" rows={rows.map((r) => ({ ...r, groups: r.groupIds.map((id) => groupOf.get(id)?.name).filter(Boolean).join(", "), tags: r.tags.join(", ") }))} columns={[{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "company", label: "Company" }, { key: "title", label: "Job title" }, { key: "phone", label: "Phone" }, { key: "groups", label: "Groups" }, { key: "tags", label: "Tags" }]} />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit("new")}>New contact</Button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">{side}</aside>
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] lg:hidden">
          {[{ id: null, name: "All", color: "" }, { id: "fav", name: "Favourites", color: "" }, ...(d?.groups ?? [])].map((g) => (
            <button key={g.id ?? "all"} type="button" onClick={() => setGroup(g.id as string | null)} className={cx("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium ring-1", group === g.id ? "bg-fg text-bg ring-fg" : "ring-border")}>{g.color && <span className="size-2 rounded-full" style={{ background: g.color }} />}{g.name}</button>
          ))}
          <button type="button" onClick={() => setGroupEdit("new")} className="inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[12.5px] text-muted ring-1 ring-border">+ Group</button>
        </div>

        <section className="min-w-0">
          {current && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[16px] border border-border bg-surface px-4 py-3">
              <span className="grid size-9 place-items-center rounded-full text-white" style={{ background: current.color }}><Users className="size-4" /></span>
              <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">{current.name}</p><p className="truncate text-[12.5px] text-muted">{current.count} {current.count === 1 ? "person" : "people"}{current.description ? ` · ${current.description}` : ""}</p></div>
              <Button variant="primary" icon={<Mail className="size-3.5" />} disabled={!current.count} onClick={() => emailGroup(current)}>Email the group</Button>
              <Menu label="Group" trigger={(p) => <IconButton {...p} label="Group options" icon={<MoreHorizontal className="size-4" />} />} items={[{ label: "Edit group", icon: <Pencil />, onSelect: () => setGroupEdit(current) }, { label: "Delete group", icon: <Trash2 />, danger: true, onSelect: () => setConfirm({ kind: "group", g: current }) }]} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input aria-label="Find a contact" value={text} onChange={(e) => setText(e.target.value)} placeholder="Find by name, email, company or tag" className="h-9 w-full rounded-[11px] border border-border bg-[var(--surface-solid)] pr-3 pl-9 text-[13.5px] outline-none focus:border-sky-500/50" style={{ outline: "none" }} />
            </div>
          </div>

          {picked.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[14px] bg-sky-500/[0.08] px-3 py-2 text-[13px]">
              <span className="font-semibold">{picked.length} selected</span>
              <Button size="sm" variant="primary" icon={<Mail className="size-3.5" />} onClick={() => compose({ to: picked.map((c) => c.email), title: picked.length > 1 ? `Email ${picked.length} people` : undefined })}>Email</Button>
              {!!d?.groups.length && <Menu label="Add to group" align="start" trigger={(p) => <Button {...p} size="sm" icon={<Users className="size-3.5" />}>Add to group</Button>} items={d.groups.map((g) => ({ label: g.name, onSelect: () => void bulk("addToGroup", g.id) }))} />}
              {current && <Button size="sm" onClick={() => void bulk("removeFromGroup", current.id)}>Remove from {current.name}</Button>}
              <Button size="sm" icon={<Star className="size-3.5" />} onClick={() => void bulk("favorite")}>Favourite</Button>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm({ kind: "contacts", ids: [...selected] })}>Delete</Button>
              <IconButton size="sm" className="ml-auto" label="Clear selection" icon={<X className="size-4" />} onClick={() => setSelected(new Set())} />
            </div>
          )}

          <div className="mt-3 overflow-hidden rounded-[20px] border border-border bg-surface">
            {q.isError ? (
              <div className="p-6"><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>
            ) : !d ? (
              <div className="grid gap-2 p-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 rounded-[12px]" />)}</div>
            ) : !rows.length ? (
              <EmptyState className="py-14" icon={<Users className="size-6" />} title={find ? "Nobody matches" : group ? "No one here yet" : "No contacts yet"} description={find ? "Try part of the name, email or company." : group && group !== "fav" ? "Select people in All contacts and add them to this group." : "Add people one by one, or import a spreadsheet (Excel, CSV, Google Contacts export)."} action={!find && !group ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit("new")}>New contact</Button> : undefined} />
            ) : (
              <ul className="divide-y divide-border">
                <li className="flex items-center gap-3 px-4 py-2 text-[11.5px] font-medium text-muted">
                  <input type="checkbox" aria-label="Select all" checked={rows.every((r) => selected.has(r.id))} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} className="size-4 accent-sky-600" />
                  <span>{rows.length} {rows.length === 1 ? "contact" : "contacts"}</span>
                </li>
                {rows.map((c) => (
                  <li key={c.id} className={cx("group flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5", selected.has(c.id) && "bg-sky-500/[0.05]")}>
                    <input type="checkbox" aria-label={`Select ${c.name || c.email}`} checked={selected.has(c.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} className="size-4 accent-sky-600" />
                    <Avatar p={{ name: c.name, address: c.email }} size={34} />
                    <button type="button" onClick={() => setEdit(c)} className="min-w-0 flex-1 basis-[200px] text-left">
                      <span className="flex items-center gap-1.5 text-[13.5px] font-semibold"><span className="truncate">{c.name || c.email}</span>{c.favorite && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}</span>
                      <span className="block truncate text-[12px] text-muted">{c.name ? c.email : ""}{c.company ? `${c.name ? " · " : ""}${c.company}` : ""}{c.title ? ` · ${c.title}` : ""}</span>
                    </button>
                    <span className="flex flex-wrap gap-1">
                      {c.groupIds.map((id) => groupOf.get(id)).filter(Boolean).slice(0, 3).map((g) => <span key={g!.id} className="inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium text-white" style={{ background: g!.color }}>{g!.name}</span>)}
                      {c.tags.slice(0, 2).map((t) => <Badge key={t}>{t}</Badge>)}
                    </span>
                    <span className="hidden w-24 shrink-0 text-right text-[11.5px] text-muted md:block">{c.lastEmailedAt ? `emailed ${shortTime(c.lastEmailedAt)}` : ""}</span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <IconButton size="sm" label={`Email ${c.name || c.email}`} icon={<Mail className="size-4" />} onClick={() => compose({ to: [c.email] })} />
                      <IconButton size="sm" label={c.favorite ? "Unfavourite" : "Favourite"} icon={<Star className={cx("size-4", c.favorite && "fill-amber-400 text-amber-400")} />} onClick={() => void star(c)} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {edit && <ContactEditor contact={edit === "new" ? null : edit} groups={d?.groups ?? []} defaultGroup={current?.id} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} onDelete={(c) => { setEdit(null); setConfirm({ kind: "contacts", ids: [c.id] }); }} />}
      {groupEdit && <GroupEditor group={groupEdit === "new" ? null : groupEdit} onClose={() => setGroupEdit(null)} onSaved={(id) => { setGroupEdit(null); setGroup(id); reload(); }} />}
      {confirm && (
        <ConfirmDialog
          open
          destructive
          onClose={() => setConfirm(null)}
          title={confirm.kind === "group" ? `Delete the group “${confirm.g.name}”?` : `Delete ${confirm.ids.length === 1 ? "this contact" : `${confirm.ids.length} contacts`}?`}
          description={confirm.kind === "group" ? "The people stay in your contacts; only the group goes." : "They're removed from the address book and its groups. Their emails in Mail stay."}
          confirmLabel="Delete"
          onConfirm={async () => {
            try {
              if (confirm.kind === "group") {
                await call(`groups/${confirm.g.id}`, "DELETE");
                setGroup(null);
              } else {
                await call("contacts/bulk", "POST", { ids: confirm.ids, action: "delete" });
                setSelected(new Set());
              }
              reload();
            } catch (e) {
              toast({ tone: "error", title: errorMessage(e) });
            }
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

function SideItem({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button type="button" aria-current={active ? "page" : undefined} onClick={onClick} className={cx("flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-[13px] transition-colors", active ? "bg-fg/[0.07] font-semibold" : "text-fg/85 hover:bg-surface-2")}>
      <span className="grid w-4 shrink-0 place-items-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11.5px] tabular-nums text-muted">{count}</span>}
    </button>
  );
}

/** Add or change a contact (also used from an email: "Save to contacts"). */
export function ContactEditor({ contact, groups, defaultGroup, initial, onClose, onSaved, onDelete }: { contact: ContactOut | null; groups: GroupOut[]; defaultGroup?: string; initial?: { name?: string; email?: string; company?: string }; onClose: () => void; onSaved: () => void; onDelete?: (c: ContactOut) => void }) {
  const { call } = useMailApi();
  const toast = useToast();
  const [f, setF] = useState({ name: contact?.name ?? initial?.name ?? "", email: contact?.email ?? initial?.email ?? "", company: contact?.company ?? initial?.company ?? "", title: contact?.title ?? "", phone: contact?.phone ?? "", notes: contact?.notes ?? "", tags: (contact?.tags ?? []).join(", "), favorite: contact?.favorite ?? false, groupIds: contact?.groupIds ?? (defaultGroup ? [defaultGroup] : []) });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await call(contact ? `contacts/${contact.id}` : "contacts", contact ? "PUT" : "POST", { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) });
      toast({ tone: "success", title: contact ? "Saved" : "Added to contacts" });
      onSaved();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f, v: string | boolean | string[]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open onClose={onClose} size="lg" title={contact ? "Edit contact" : "New contact"} footer={<>{contact && onDelete && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-4" />} onClick={() => onDelete(contact)}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.email.trim()} onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">{(p) => <Input {...p} autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Asha Rao" />}</Field>
          <Field label="Email">{(p) => <Input {...p} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="asha@company.com" />}</Field>
          <Field label="Company">{(p) => <Input {...p} value={f.company} onChange={(e) => set("company", e.target.value)} />}</Field>
          <Field label="Job title">{(p) => <Input {...p} value={f.title} onChange={(e) => set("title", e.target.value)} />}</Field>
          <Field label="Phone">{(p) => <Input {...p} value={f.phone} onChange={(e) => set("phone", e.target.value)} />}</Field>
          <Field label="Tags" hint="Comma-separated">{(p) => <Input {...p} value={f.tags} onChange={(e) => set("tags", e.target.value)} placeholder="vip, mumbai" />}</Field>
        </div>
        {groups.length > 0 && (
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Groups</p>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => {
                const on = f.groupIds.includes(g.id);
                return <button key={g.id} type="button" aria-pressed={on} onClick={() => set("groupIds", on ? f.groupIds.filter((x) => x !== g.id) : [...f.groupIds, g.id])} className={cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium ring-1 transition-colors", on ? "text-white ring-transparent" : "ring-border hover:bg-surface-2")} style={on ? { background: g.color } : undefined}>{on ? <Check className="size-3.5" /> : <span className="size-2 rounded-full" style={{ background: g.color }} />}{g.name}</button>;
              })}
            </div>
          </div>
        )}
        <Field label="Notes">{(p) => <Textarea {...p} rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field>
        <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={f.favorite} onChange={(e) => set("favorite", e.target.checked)} className="size-4 accent-sky-600" /> Favourite — suggested first when you write</label>
      </div>
    </Dialog>
  );
}

function GroupEditor({ group, onClose, onSaved }: { group: GroupOut | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { call } = useMailApi();
  const toast = useToast();
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState(group?.color ?? COLORS[0]!);
  const [description, setDescription] = useState(group?.description ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await call<{ id: string }>(group ? `groups/${group.id}` : "groups", group ? "PUT" : "POST", { name, color, description });
      onSaved(r.id);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title={group ? "Edit group" : "New group"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-4">
        <Field label="Name">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Suppliers" />}</Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Colour</p>
          <div className="flex flex-wrap gap-2">{COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} className={cx("grid size-7 place-items-center rounded-full", c === color && "ring-2 ring-fg ring-offset-2 ring-offset-[var(--bg)]")} style={{ background: c }}>{c === color && <Check className="size-3.5 text-white" />}</button>)}</div>
        </div>
        <Field label="Description" hint="Optional">{(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who's in it" />}</Field>
      </div>
    </Dialog>
  );
}
