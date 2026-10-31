"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { Suspense, useState } from "react";
import { setTheme, useSession, useThemePref, type ThemePref } from "@/components/shell/session-context";
import { Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, Field, Input, Skeleton } from "@/components/ui/primitives";
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
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Profile</h2>
        <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
          <dt className="text-muted">Name</dt>
          <dd>{user.name}</dd>
          <dt className="text-muted">Email</dt>
          <dd className="flex items-center gap-2">
            {user.email} {user.emailVerified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Unverified</Badge>}
          </dd>
        </dl>
      </Card>

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
