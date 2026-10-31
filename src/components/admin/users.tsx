"use client";

// Every account on the platform, and the platform's own admins. Find people,
// see their workspaces, sessions and sign-ins; disable, sign out everywhere,
// confirm an email; owners also give and take admin roles.
import { Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog, Dialog } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Select, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import { PLATFORM_ROLES, ROLE_LABEL } from "@/lib/platform/admin-roles";
import { Section, useAdmin, useCan, useRun } from "./common";

type U = { id: string; name: string; email: string; verified: boolean; mfa: boolean; isPlatformAdmin: boolean; platformRole: string | null; disabledAt: string | null; disabledReason: string; workspaces: number; lastSeen: string | null; createdAt: string };
type Detail = { user: U | null; memberships: { orgId: string; name: string; slug: string; role: string; joinedAt: string }[]; sessions: { ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string }[]; logins: { ok: boolean; method: string; reason: string; ip: string | null; at: string }[] };

function UserTable({ rows, onOpen }: { rows: U[]; onOpen: (id: string) => void }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-[13px]">
        <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2.5 font-medium">Person</th><th className="px-4 py-2.5 font-medium">Security</th><th className="px-4 py-2.5 text-right font-medium">Workspaces</th><th className="px-4 py-2.5 font-medium">Last seen</th><th className="px-4 py-2.5 font-medium">State</th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((u) => (
            <tr key={u.id} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpen(u.id)}>
              <td className="px-4 py-2.5"><b className="font-medium">{u.name}</b>{u.platformRole && <Badge tone="accent" className="ml-1.5">{ROLE_LABEL[u.platformRole as keyof typeof ROLE_LABEL]?.name ?? u.platformRole}</Badge>}<span className="block text-[12px] text-muted">{u.email}</span></td>
              <td className="px-4 py-2.5"><span className="flex flex-wrap gap-1">{u.verified ? <Badge tone="success">verified</Badge> : <Badge tone="warning">unverified</Badge>}{u.mfa && <Badge tone="success">two-step</Badge>}</span></td>
              <td className="px-4 py-2.5 text-right tabular-nums">{u.workspaces}</td>
              <td className="px-4 py-2.5 text-muted">{u.lastSeen ? dateTime(u.lastSeen) : "—"}</td>
              <td className="px-4 py-2.5">{u.disabledAt ? <Badge tone="danger">Disabled</Badge> : <Badge tone="success">Active</Badge>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Nobody matches.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

export function UsersPanel() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const qs = new URLSearchParams({ q, filter }).toString();
  const list = useAdmin<{ users: U[] }>(`users?${qs}`);
  const [open, setOpen] = useState<string | null>(null);
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search people" className="!w-64" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Filter people" className="!w-48" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Everyone</option><option value="admins">Platform admins</option><option value="disabled">Disabled</option><option value="unverified">Email not verified</option><option value="no_mfa">No two-step</option>
        </Select>
        <a href={`/api/v1/admin/users/csv?${qs}`} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2"><Download className="size-3.5" /> Export CSV</a>
      </div>
      {!list.data ? <Skeleton className="h-60" /> : <UserTable rows={list.data.users} onOpen={setOpen} />}
      {open && <UserDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function AdminsPanel() {
  const list = useAdmin<{ users: U[] }>("users?filter=admins");
  const [open, setOpen] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const found = useAdmin<{ users: U[] }>(`users?q=${encodeURIComponent(find)}`, { enabled: find.trim().length >= 3 });
  const can = useCan();
  return (
    <div className="space-y-8">
      <Section title="Roles" sub="Each admin has one role; every action checks it on the server.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PLATFORM_ROLES.map((r) => (
            <Card key={r} className="p-3.5"><p className="flex items-center gap-1.5 text-[13px] font-semibold"><ShieldCheck className="size-4 text-accent" />{ROLE_LABEL[r].name}</p><p className="mt-1 text-[12.5px] text-muted">{ROLE_LABEL[r].what}</p></Card>
          ))}
        </div>
      </Section>
      <Section title="Platform admins">
        {!list.data ? <Skeleton className="h-40" /> : <UserTable rows={list.data.users} onOpen={setOpen} />}
      </Section>
      {can("admins:write") && (
        <Section title="Add an admin" sub="Find their account (they sign up first), then give them a role. Their sessions end so the role applies at once.">
          <Input aria-label="Find an account" className="!w-80" placeholder="Email (3+ characters)" value={find} onChange={(e) => setFind(e.target.value)} />
          {found.data && find.trim().length >= 3 && <UserTable rows={found.data.users.filter((u) => !u.isPlatformAdmin).slice(0, 8)} onOpen={setOpen} />}
        </Section>
      )}
      {open && <UserDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function UserDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useAdmin<Detail>(`users/${id}`);
  const run = useRun();
  const can = useCan();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<null | "disable" | "signout" | "role">(null);
  const [role, setRole] = useState<string | null>(null);
  const picked = role ?? q.data?.user?.platformRole ?? "";
  const u = q.data?.user;
  return (
    <Dialog open onClose={onClose} size="lg" title={u?.name ?? "Person"} description={u?.email} footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {!q.data || !u ? <Skeleton className="h-40" /> : (
        <div className="space-y-5 text-[13.5px]">
          <p className="flex flex-wrap gap-1.5">{u.verified ? <Badge tone="success">Email verified</Badge> : <Badge tone="warning">Email not verified</Badge>}{u.mfa ? <Badge tone="success">Two-step on</Badge> : <Badge>Two-step off</Badge>}{u.platformRole && <Badge tone="accent">Platform {u.platformRole}</Badge>}<span className="text-muted">Joined {dateTime(u.createdAt)}</span></p>
          {u.disabledAt && <p className="rounded-[12px] bg-danger-soft p-3">Disabled {dateTime(u.disabledAt)}: {u.disabledReason}</p>}

          {can("users:write") && (
            <div className="flex flex-wrap gap-2">
              {u.disabledAt ? (
                <Button onClick={() => void run(`users/${id}/enable`, "POST", {}, "Account enabled")}>Enable account</Button>
              ) : (
                <>
                  <Input aria-label="Reason to disable" className="!w-64" placeholder="Reason to disable" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button variant="danger" disabled={!reason.trim()} onClick={() => setConfirm("disable")}>Disable</Button>
                </>
              )}
              <Button onClick={() => setConfirm("signout")}>Sign out everywhere</Button>
              {!u.verified && <Button onClick={() => void run(`users/${id}/verify`, "POST", {}, "Email marked verified")}>Mark email verified</Button>}
            </div>
          )}

          {can("admins:write") && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Platform admin role">
                {(a) => (
                  <Select {...a} value={picked} onChange={(e) => setRole(e.target.value)}>
                    <option value="">Not an admin</option>
                    {PLATFORM_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r].name} — {ROLE_LABEL[r].what}</option>)}
                  </Select>
                )}
              </Field>
              <Button disabled={picked === (u.platformRole ?? "")} onClick={() => setConfirm("role")}>Save role</Button>
            </div>
          )}

          <div>
            <p className="mb-1 font-medium">Workspaces</p>
            {q.data.memberships.length ? <ul className="space-y-0.5">{q.data.memberships.map((m) => <li key={m.orgId}>{m.name} <span className="text-muted">· {m.role}</span></li>)}</ul> : <p className="text-muted">None.</p>}
          </div>
          <div>
            <p className="mb-1 font-medium">Signed in on ({q.data.sessions.length})</p>
            <ul className="space-y-0.5 text-[12.5px] text-muted">{q.data.sessions.map((s, i) => <li key={i} className="truncate">{s.ip ?? "unknown address"} · {s.userAgent?.slice(0, 80) ?? "unknown device"} · last {dateTime(s.lastSeenAt)}</li>)}</ul>
          </div>
          <div>
            <p className="mb-1 font-medium">Recent sign-ins</p>
            <ul className="space-y-0.5 text-[12.5px]">{q.data.logins.map((l, i) => <li key={i} className={l.ok ? "text-muted" : "text-danger"}>{dateTime(l.at)} · {l.method} · {l.ok ? "ok" : `failed (${l.reason})`} · {l.ip ?? ""}</li>)}{!q.data.logins.length && <li className="text-muted">None recorded.</li>}</ul>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        destructive={confirm !== "role"}
        title={confirm === "disable" ? `Disable ${u?.email}?` : confirm === "signout" ? "Sign out everywhere?" : "Change admin role?"}
        description={confirm === "disable" ? "They can't sign in, and every session ends now. Their workspaces keep working for other members." : confirm === "signout" ? "Every session for this person ends; they can sign in again." : picked ? `They become a platform ${picked}. Their sessions end so it applies at once.` : "They stop being a platform admin. Their sessions end."}
        confirmLabel={confirm === "disable" ? "Disable" : confirm === "signout" ? "Sign out" : "Save role"}
        onConfirm={async () => {
          if (confirm === "disable") await run(`users/${id}/disable`, "POST", { reason }, "Account disabled");
          if (confirm === "signout") await run(`users/${id}/signout`, "POST", {}, "Signed out everywhere");
          if (confirm === "role") await run(`users/${id}/role`, "PUT", { role: picked || null }, "Role saved");
          setConfirm(null);
        }}
      />
    </Dialog>
  );
}
