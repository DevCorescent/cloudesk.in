"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { setTheme, useSession, useThemePref, type ThemePref } from "@/components/shell/session-context";
import { Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, Field, Input, Skeleton, Switch } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";
import { SecurityCard, SignInsCard, useMfaStatus } from "./security";

type Session = { id: string; ip: string | null; userAgent: string | null; createdAt: string; current: boolean };

function describeAgent(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function AccountView() {
  const { user } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const theme = useThemePref();
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [pwErrors, setPwErrors] = useState<Record<string, string[]>>({});
  const mfa = useMfaStatus();
  const hasPassword = mfa.data?.hasPassword !== false;
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api<{ sessions: Session[] }>("/api/v1/auth/sessions") });

  const change = useMutation({
    mutationFn: () => api("/api/v1/auth/password", { method: "PATCH", body: pw }),
    onSuccess: () => {
      setPw({ currentPassword: "", newPassword: "" });
      setPwErrors({});
      qc.invalidateQueries({ queryKey: ["mfa"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast({ tone: "success", title: "Password changed", description: "Other sessions were signed out." });
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === "validation_failed") setPwErrors(e.fieldErrors());
      else toast({ tone: "error", title: "Could not change password", description: errorMessage(e) });
    },
  });
  const revoke = useMutation({
    mutationFn: (body: { id?: string; others?: boolean }) => api("/api/v1/auth/sessions", { method: "DELETE", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
    onError: (e) => toast({ tone: "error", title: "Could not sign out session", description: errorMessage(e) }),
  });

  return (
    <div className="grid gap-6">
      <ProfileCard email={user.email} verified={user.emailVerified} />

      <Card className="p-5">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <div className="mt-3">
          <Segmented
            label="Theme"
            value={theme}
            onChange={(t: ThemePref) => setTheme(t)}
            options={[
              { value: "light", label: <><Sun className="size-3.5" /> Light</> },
              { value: "dark", label: <><Moon className="size-3.5" /> Dark</> },
              { value: "system", label: <><Monitor className="size-3.5" /> System</> },
            ]}
          />
        </div>
      </Card>

      <Suspense>
        <SecurityCard />
        <SignInsCard />
      </Suspense>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">{hasPassword ? "Change password" : "Set a password"}</h2>
        {!hasPassword && <p className="mt-1 text-xs text-muted">You signed up with GitHub. A password lets you sign in without it too.</p>}
        <form className="mt-4 grid max-w-sm gap-4" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
          {hasPassword && <Field label="Current password" error={pwErrors.currentPassword?.[0]}>{(p) => <Input {...p} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>}
          <Field label="New password" hint="At least 10 characters, with a number or symbol." error={pwErrors.newPassword?.[0]}>{(p) => <Input {...p} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
          <Button type="submit" variant="primary" className="justify-self-start" loading={change.isPending} disabled={(hasPassword && !pw.currentPassword) || !pw.newPassword}>
            {hasPassword ? "Update password" : "Set password"}
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Active sessions</h2>
          <Button size="sm" onClick={() => revoke.mutate({ others: true })} loading={revoke.isPending && !!revoke.variables?.others} disabled={(sessions.data?.sessions.length ?? 0) < 2}>
            Sign out other sessions
          </Button>
        </div>
        {sessions.isPending ? (
          <Skeleton className="mt-3 h-16" />
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {sessions.data?.sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {describeAgent(s.userAgent)} {s.current && <Badge tone="accent">This device</Badge>}
                  </p>
                  <p className="text-xs text-muted">{s.ip ?? "Unknown IP"} · signed in {timeAgo(s.createdAt)}</p>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ id: s.id })}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

type Profile = { name: string; email: string; username: string; phone: string; discoverable: boolean };

/** Name, username, a phone number people can find you by, and whether they can find you at all. */
function ProfileCard({ email, verified }: { email: string; verified: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["profile"], queryFn: () => api<{ profile: Profile }>("/api/v1/auth/profile") });
  const [v, setV] = useState<Profile | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [checked, setChecked] = useState<{ name: string; ok: boolean; reason?: string } | null>(null);
  const p = v ?? q.data?.profile ?? null;
  const changedName = p && q.data && p.username !== q.data.profile.username ? p.username : "";
  // Whether the new username is free, checked a moment after typing stops.
  useEffect(() => {
    if (!changedName) return;
    const t = setTimeout(() => void api<{ ok: boolean; reason?: string }>(`/api/v1/auth/profile?username=${encodeURIComponent(changedName)}`).then((r) => setChecked({ name: changedName, ...r }), () => undefined), 300);
    return () => clearTimeout(t);
  }, [changedName]);
  const check = checked && checked.name === changedName ? checked : null;
  const save = useMutation({
    mutationFn: () => api<{ profile: Profile }>("/api/v1/auth/profile", { method: "PATCH", body: { name: p!.name, username: p!.username, phone: p!.phone, discoverable: p!.discoverable } }),
    onSuccess: (r) => {
      setV(null);
      setErrors({});
      qc.setQueryData(["profile"], r);
      toast({ tone: "success", title: "Profile saved" });
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setErrors(e.fieldErrors());
      else toast({ tone: "error", title: errorMessage(e) });
    },
  });
  if (!p) return <Skeleton className="h-48" />;
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(q.data?.profile);
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Profile</h2>
      <p className="mt-0.5 text-[12.5px] text-muted">People invite you to workspaces and chats by your username — your email and phone are never shown to them.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={errors.name?.[0]}>{(f) => <Input {...f} value={p.name} onChange={(e) => setV({ ...p, name: e.target.value })} maxLength={120} />}</Field>
        <Field label="Username" error={errors.username?.[0] ?? (check && !check.ok ? check.reason : undefined)} hint={check?.ok ? "Available" : "Letters, digits, dots and underscores"}>
          {(f) => (
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-muted">@</span>
              <Input {...f} className="pl-7" value={p.username} maxLength={30} onChange={(e) => setV({ ...p, username: e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, "") })} />
            </div>
          )}
        </Field>
        <div className="grid gap-1.5 text-[13px]">
          <span className="font-medium">Email</span>
          <span className="flex h-9 items-center gap-2">{email} {verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Unverified</Badge>}</span>
        </div>
        <Field label="Phone" error={errors.phone?.[0]} hint="Optional — so people who have your number can find you">{(f) => <Input {...f} type="tel" value={p.phone} onChange={(e) => setV({ ...p, phone: e.target.value })} maxLength={30} />}</Field>
      </div>
      <label className="mt-4 flex items-start gap-2 text-[13px]">
        <Switch label="Let people find me" checked={p.discoverable} onChange={(x) => setV({ ...p, discoverable: x })} />
        <span>
          Let people outside my workspaces find me by username, email or phone
          <span className="block text-[12px] text-muted">People in your workspaces can always find you.</span>
        </span>
      </label>
      {dirty && (
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => (setV(null), setErrors({}))}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!!check && !check.ok} onClick={() => save.mutate()}>Save</Button>
        </div>
      )}
    </Card>
  );
}
