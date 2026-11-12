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
  const mfa = useMfaStatus();
  const hasPassword = mfa.data?.hasPassword !== false;
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api<{ sessions: Session[] }>("/api/v1/auth/sessions") });

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

      <PasswordCard email={user.email} hasPassword={hasPassword} />

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

/**
 * Change (or set) the password. Forgot the current one? A six-digit code
 * emailed to the account stands in for it.
 */
function PasswordCard({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [byCode, setByCode] = useState(false);
  const [pw, setPw] = useState({ currentPassword: "", code: "", newPassword: "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [sent, setSent] = useState<{ at: number; devCode?: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sent) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sent]);
  const wait = sent ? Math.max(0, 30 - Math.floor((now - sent.at) / 1000)) : 0;

  const send = useMutation({
    mutationFn: () => api<{ devCode?: string }>("/api/v1/auth/password/code", { method: "POST" }),
    onSuccess: (r) => {
      setSent({ at: Date.now(), devCode: r.devCode });
      setNow(Date.now());
      toast({ tone: "success", title: "Code sent", description: `Check ${email}.` });
    },
    onError: (e) => toast({ tone: "error", title: "Could not send a code", description: errorMessage(e) }),
  });
  const change = useMutation({
    mutationFn: () => api("/api/v1/auth/password", { method: "PATCH", body: byCode ? { code: pw.code, newPassword: pw.newPassword } : { currentPassword: pw.currentPassword, newPassword: pw.newPassword } }),
    onSuccess: () => {
      setPw({ currentPassword: "", code: "", newPassword: "" });
      setErrors({});
      setByCode(false);
      setSent(null);
      qc.invalidateQueries({ queryKey: ["mfa"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast({ tone: "success", title: "Password changed", description: "Other sessions were signed out." });
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === "validation_failed") setErrors(e.fieldErrors());
      else if (byCode) setErrors({ code: [errorMessage(e)] });
      else toast({ tone: "error", title: "Could not change password", description: errorMessage(e) });
    },
  });
  const switchTo = (code: boolean) => {
    setByCode(code);
    setErrors({});
  };
  const ready = !!pw.newPassword && (byCode ? pw.code.replace(/\D/g, "").length === 6 : !hasPassword || !!pw.currentPassword);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">{byCode ? "Reset your password" : hasPassword ? "Change password" : "Set a password"}</h2>
      {!hasPassword && !byCode && <p className="mt-1 text-xs text-muted">You signed up with GitHub. A password lets you sign in without it too.</p>}
      {byCode && <p className="mt-1 text-xs text-muted">We&apos;ll email a six-digit code to <span className="font-medium text-fg">{email}</span>. It works once, for 10 minutes.</p>}
      <form className="mt-4 grid max-w-sm gap-4" onSubmit={(e) => { e.preventDefault(); if (ready) change.mutate(); }}>
        {byCode ? (
          <>
            <div className="flex items-end gap-2">
              <Field label="Code from the email" className="min-w-0 flex-1" error={errors.code?.[0]}>
                {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={pw.code} onChange={(e) => setPw({ ...pw, code: e.target.value })} disabled={!sent} className="tracking-[0.3em] tabular-nums" />}
              </Field>
              <Button type="button" loading={send.isPending} disabled={wait > 0} onClick={() => send.mutate()}>{!sent ? "Email me a code" : wait > 0 ? `Resend in ${wait}s` : "Resend"}</Button>
            </div>
            {sent?.devCode && <p className="text-xs text-muted">Development (no mail service): the code is <span className="font-mono font-medium text-fg">{sent.devCode}</span></p>}
          </>
        ) : hasPassword && (
          <Field label="Current password" error={errors.currentPassword?.[0]}>{(p) => <Input {...p} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
        )}
        <Field label="New password" hint="At least 10 characters, with a number or symbol." error={errors.newPassword?.[0]}>{(p) => <Input {...p} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} disabled={byCode && !sent} />}</Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={change.isPending} disabled={!ready}>
            {byCode ? "Reset password" : hasPassword ? "Update password" : "Set password"}
          </Button>
          {hasPassword && (
            <button type="button" className="text-xs font-medium text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => switchTo(!byCode)}>
              {byCode ? "I remember it" : "Forgot your current password?"}
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
