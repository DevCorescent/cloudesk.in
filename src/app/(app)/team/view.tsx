"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, MoreHorizontal, Pencil, Plus, Trash2, UserMinus, X } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { ConfirmDialog, Dialog, Menu, useToast } from "@/components/ui/overlays";
import { OrgSecurityCard } from "./security";
import { Badge, Button, Card, ErrorState, Field, IconButton, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { ModuleGlyph } from "@/components/shell/module-glyph";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";
import { MODULE_GROUPS, MODULES, moduleById, type ModuleId } from "@/lib/workspace/modules";

type Member = { userId: string; name: string; email: string; role: string; customRoleId: string | null; joinedAt: string };
type CustomRole = { id: string; name: string; description: string; baseRole: string; modules: string[]; members: number };
type Invitation = { id: string; email: string; role: string; expiresAt: string };

const ROLE_INFO: Record<string, string> = {
  owner: "Full control, including billing and deleting the organization",
  admin: "Manage members, providers and every project",
  developer: "Edit design and code, deploy to production",
  designer: "Edit design and content, deploy previews",
  editor: "Edit content, deploy previews, read submissions",
  billing: "Manage billing; read-only on projects",
  viewer: "Read-only access",
  employee: "Only their own HR — check in, leave, payslips and claims",
};
const ROLES = Object.keys(ROLE_INFO);

export function TeamView() {
  const { org, user } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: "", role: "editor" });
  const [inviteError, setInviteError] = useState<string>();
  const [removing, setRemoving] = useState<Member | null>(null);
  const members = useQuery({ queryKey: ["members", org.id], queryFn: () => api<{ members: Member[]; yourRole: string }>(`/api/v1/orgs/${org.id}/members`) });
  const canManage = members.data && ["owner", "admin"].includes(members.data.yourRole);
  const invites = useQuery({ queryKey: ["invitations", org.id], queryFn: () => api<{ invitations: Invitation[] }>(`/api/v1/orgs/${org.id}/invitations`), enabled: !!canManage });
  const custom = useQuery({ queryKey: ["roles", org.id], queryFn: () => api<{ roles: CustomRole[] }>(`/api/v1/orgs/${org.id}/roles`) });
  const [editingRole, setEditingRole] = useState<Partial<CustomRole> | null>(null);
  const [deletingRole, setDeletingRole] = useState<CustomRole | null>(null);
  const delRole = useMutation({
    mutationFn: (id: string) => api(`/api/v1/orgs/${org.id}/roles/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeletingRole(null);
      qc.invalidateQueries({ queryKey: ["roles", org.id] });
      refresh();
      toast({ tone: "success", title: "Role deleted" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not delete", description: errorMessage(e) }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["members", org.id] });
    qc.invalidateQueries({ queryKey: ["invitations", org.id] });
  };
  const send = useMutation({
    mutationFn: () => api(`/api/v1/orgs/${org.id}/invitations`, { method: "POST", body: invite }),
    onSuccess: () => {
      refresh();
      setInviteOpen(false);
      setInvite({ email: "", role: "editor" });
      toast({ tone: "success", title: "Invitation sent" });
    },
    onError: (e) => setInviteError(e instanceof ApiClientError ? (e.fieldErrors().email?.[0] ?? e.message) : errorMessage(e)),
  });
  const changeRole = useMutation({
    // "c:<id>" picks a workspace role; anything else is a built-in role.
    mutationFn: (v: { userId: string; role: string }) => api(`/api/v1/orgs/${org.id}/members/${v.userId}`, { method: "PATCH", body: v.role.startsWith("c:") ? { customRoleId: v.role.slice(2) } : { role: v.role } }),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["roles", org.id] });
      toast({ tone: "success", title: "Role updated" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not change role", description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api(`/api/v1/orgs/${org.id}/members/${userId}`, { method: "DELETE" }),
    onSuccess: (_d, userId) => {
      setRemoving(null);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload clears cached data from the previous session/org
      if (userId === user.id) window.location.assign("/home");
      else refresh();
    },
    onError: (e) => toast({ tone: "error", title: "Could not remove", description: errorMessage(e) }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/orgs/${org.id}/invitations/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (e) => toast({ tone: "error", title: "Could not revoke", description: errorMessage(e) }),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Team"
        description={`People in ${org.name} and what they can do.`}
        actions={canManage && <Button variant="primary" icon={<MailPlus className="size-3.5" />} onClick={() => { setInviteError(undefined); setInviteOpen(true); }}>Invite</Button>}
      />
      {members.isPending ? (
        <Skeleton className="h-48" />
      ) : members.isError ? (
        <ErrorState message={errorMessage(members.error)} onRetry={() => members.refetch()} />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {members.data.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold">{m.name.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {m.name} {m.userId === user.id && <span className="font-normal text-subtle">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                </div>
                {canManage && m.userId !== user.id ? (
                  <Select aria-label={`Role for ${m.name}`} className="w-44" value={m.customRoleId ? `c:${m.customRoleId}` : m.role} onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value })}>
                    <optgroup label="Built-in">
                      {ROLES.map((r) => (
                        <option key={r} value={r} disabled={r === "owner" && members.data.yourRole !== "owner"}>
                          {r[0].toUpperCase() + r.slice(1)}
                        </option>
                      ))}
                    </optgroup>
                    {!!custom.data?.roles.length && (
                      <optgroup label="Your roles">
                        {custom.data.roles.map((r) => (
                          <option key={r.id} value={`c:${r.id}`}>
                            {r.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                ) : (
                  <Badge className="capitalize">{custom.data?.roles.find((r) => r.id === m.customRoleId)?.name ?? m.role}</Badge>
                )}
                <Menu
                  label={`Actions for ${m.name}`}
                  trigger={(p) => <IconButton {...p} label={`Actions for ${m.name}`} size="sm" icon={<MoreHorizontal className="size-4" />} />}
                  items={[
                    m.userId === user.id
                      ? { label: "Leave organization", icon: <UserMinus />, danger: true, onSelect: () => setRemoving(m) }
                      : { label: "Remove from organization", icon: <UserMinus />, danger: true, disabled: !canManage, onSelect: () => setRemoving(m) },
                  ]}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <OrgSecurityCard orgId={org.id} canManage={!!canManage} />
      {canManage && invites.data && invites.data.invitations.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-[13px] font-semibold">Pending invitations</h2>
          <Card>
            <ul className="divide-y divide-border">
              {invites.data.invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{i.email}</span>
                  <Badge className="capitalize">{i.role}</Badge>
                  <span className="text-xs text-subtle">expires {timeAgo(i.expiresAt)}</span>
                  <IconButton label={`Revoke invitation for ${i.email}`} size="sm" icon={<X className="size-4" />} onClick={() => revoke.mutate(i.id)} />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold">Your roles</h2>
            <p className="text-[12.5px] text-muted">Roles of your own, like “Store manager”: a built-in role&apos;s permissions, limited to the modules you pick.</p>
          </div>
          {canManage && (
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditingRole({ baseRole: "editor", modules: [] })}>
              New role
            </Button>
          )}
        </div>
        {!custom.data ? (
          <Skeleton className="h-20" />
        ) : !custom.data.roles.length ? (
          <Card>
            <p className="px-4 py-5 text-[13px] text-muted">No roles of your own yet. Make one to give someone just the Horeca screens, just HR, or the store and POS.</p>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {custom.data.roles.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">
                      {r.name} <span className="font-normal text-muted">· {r.baseRole[0].toUpperCase() + r.baseRole.slice(1)} permissions · {r.members} {r.members === 1 ? "person" : "people"}</span>
                    </p>
                    {r.description && <p className="text-[12.5px] text-muted">{r.description}</p>}
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {r.modules.map((id) => (
                        <li key={id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium">
                          <ModuleGlyph id={id as ModuleId} className="size-3" />
                          {moduleById(id)?.name ?? id}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {canManage && (
                    <span className="flex gap-1">
                      <IconButton label={`Edit ${r.name}`} size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditingRole(r)} />
                      <IconButton label={`Delete ${r.name}`} size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setDeletingRole(r)} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-[13px] font-semibold">Built-in roles</h2>
        <Card>
          <dl className="divide-y divide-border">
            {Object.entries(ROLE_INFO).map(([r, d]) => (
              <div key={r} className="flex gap-4 px-4 py-2.5 text-[13px]">
                <dt className="w-24 shrink-0 font-medium capitalize">{r}</dt>
                <dd className="text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite to organization"
        description="They will get an email with a link that expires in 7 days."
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={send.isPending} disabled={!invite.email.includes("@")} onClick={() => send.mutate()}>
              Send invitation
            </Button>
          </>
        }
      >
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <Field label="Email" error={inviteError}>{(p) => <Input {...p} type="email" autoFocus value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />}</Field>
          <Field label="Role" hint={ROLE_INFO[invite.role]}>
            {(p) => (
              <Select {...p} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                {ROLES.filter((r) => r !== "owner" || members.data?.yourRole === "owner").map((r) => (
                  <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
                ))}
              </Select>
            )}
          </Field>
        </form>
      </Dialog>
      {editingRole && <RoleDialog orgId={org.id} init={editingRole} yourRole={members.data?.yourRole ?? "viewer"} onClose={() => setEditingRole(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ["roles", org.id] }); refresh(); }} />}
      <ConfirmDialog
        open={!!deletingRole}
        onClose={() => setDeletingRole(null)}
        onConfirm={() => deletingRole && delRole.mutate(deletingRole.id)}
        loading={delRole.isPending}
        destructive
        title={`Delete “${deletingRole?.name}”?`}
        description={deletingRole?.members ? `${deletingRole.members} ${deletingRole.members === 1 ? "person keeps" : "people keep"} the ${deletingRole.baseRole} role's permissions, without the module limit.` : "Nobody has this role."}
        confirmLabel="Delete role"
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.userId)}
        loading={remove.isPending}
        destructive
        title={removing?.userId === user.id ? "Leave this organization?" : `Remove ${removing?.name}?`}
        description="They will lose access to every project in this organization immediately."
        confirmLabel={removing?.userId === user.id ? "Leave" : "Remove"}
      />
    </div>
  );
}

function RoleDialog({ orgId, init, yourRole, onClose, onSaved }: { orgId: string; init: Partial<CustomRole>; yourRole: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: init.name ?? "", description: init.description ?? "", baseRole: init.baseRole ?? "editor", modules: init.modules ?? [] });
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: () => api(`/api/v1/orgs/${orgId}/roles${init.id ? `/${init.id}` : ""}`, { method: init.id ? "PUT" : "POST", body: f }),
    onSuccess: () => {
      onSaved();
      onClose();
      toast({ tone: "success", title: init.id ? "Role saved" : "Role created" });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const pick = (id: string, on: boolean) => setF({ ...f, modules: on ? [...f.modules, id] : f.modules.filter((x) => x !== id) });
  // Admins can't hand out more than they have; nobody makes owner roles.
  const bases = ROLES.filter((r) => r !== "owner" && (yourRole === "owner" || r !== "admin"));
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={init.id ? `Edit ${init.name}` : "New role"}
      description="People with this role get the base role's permissions, but only see and use the modules you tick."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !f.modules.length} onClick={() => save.mutate()}>
            {init.id ? "Save role" : "Create role"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">{(p) => <Input {...p} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Store manager" maxLength={60} />}</Field>
          <Field label="Permissions like" hint={ROLE_INFO[f.baseRole]}>
            {(p) => (
              <Select {...p} value={f.baseRole} onChange={(e) => setF({ ...f, baseRole: e.target.value })}>
                {bases.map((r) => (
                  <option key={r} value={r}>
                    {r[0].toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Description (optional)">{(p) => <Textarea {...p} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} placeholder="Runs the shop floor: products, orders and the counter." />}</Field>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Modules they can use</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODULE_GROUPS.map((g) => (
              <div key={g.id}>
                <p className="mb-1 text-[11px] font-semibold tracking-[0.12em] text-subtle uppercase">{g.label}</p>
                {MODULES.filter((m) => m.group === g.id).map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-[10px] px-1.5 py-1 text-[13px] hover:bg-surface-2">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.modules.includes(m.id)} onChange={(e) => pick(m.id, e.target.checked)} />
                    <ModuleGlyph id={m.id} className="size-3.5 text-muted" />
                    {m.name}
                  </label>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted">Projects, the website builder and the rest of the core follow the base role. Modules a ticked one relies on (for example the store&apos;s products for Horeca) keep working in the background.</p>
        </fieldset>
        {error && <p className="text-[13px] text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
