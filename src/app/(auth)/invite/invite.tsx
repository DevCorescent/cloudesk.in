"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard, PasswordInput } from "@/components/auth-form";
import { OtpInput, useCountdown } from "@/components/otp-input";
import { Button, Field, Notice, Spinner } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";

type Preview = { orgName: string; email: string; role: string };
type Sent = { ticket: string; email: string; workspace: string; devCode?: string };

export function Invite() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    api<Preview>("/api/v1/invitations/preview", { method: "POST", body: { token } }).then(setPreview, (e) => setError(errorMessage(e)));
  }, [token]);
  async function accept() {
    setLoading(true);
    try {
      await api("/api/v1/invitations/accept", { method: "POST", body: { token } });
      router.replace("/home");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) setNeedsLogin(true);
      else setError(errorMessage(e));
      setLoading(false);
    }
  }
  const next = encodeURIComponent(`/invite?token=${token}`);
  if (creating && preview) return <CreateAccount token={token} preview={preview} onBack={() => setCreating(false)} />;
  return (
    <AuthCard title="Join a workspace">
      {error && <Notice tone="danger">{error}</Notice>}
      {!error && !preview && <Spinner />}
      {preview && !error && (
        <div className="grid gap-4">
          <p className="text-[13px] text-muted">
            You have been invited to <strong className="text-fg">{preview.orgName}</strong> as <strong className="text-fg">{preview.role}</strong>. The invitation was sent to {preview.email}.
          </p>
          {needsLogin ? (
            <div className="grid gap-2">
              <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
                Create my account
              </Button>
              <p className="text-center text-[13px] text-muted">
                Already have one? <Link className="font-medium text-fg underline" href={`/login?email=${encodeURIComponent(preview.email)}&next=${next}`}>Sign in</Link> to accept.
              </p>
            </div>
          ) : (
            <Button variant="primary" size="lg" loading={loading} onClick={accept}>
              Accept invitation
            </Button>
          )}
        </div>
      )}
    </AuthCard>
  );
}

/** A new account for the invited address: name and password, then the code we email. It joins this workspace only. */
function CreateAccount({ token, preview, onBack }: { token: string; preview: Preview; onBack: () => void }) {
  const [sent, setSent] = useState<Sent | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const wait = useCountdown(sentAt + 30_000);

  async function start(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Sent>("/api/v1/auth/signup/invited", { method: "POST", body: { token, name: String(form.get("name") ?? ""), password: String(form.get("password") ?? ""), acceptTerms: form.get("terms") === "on" } });
      setSent(r);
      setSentAt(Date.now());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify(c: string) {
    if (!sent || c.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/auth/signup/verify", { method: "POST", body: { ticket: sent.ticket, code: c } });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
      setCode("");
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    if (!sent) return;
    setError(null);
    try {
      const r = await api<Sent>("/api/v1/auth/signup/resend", { method: "POST", body: { ticket: sent.ticket } });
      setSent({ ...sent, ...r });
      setSentAt(Date.now());
      setCode("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (done) {
    return (
      <AuthCard title="You're in" subtitle={<>Your account is ready and you&apos;ve joined <strong className="text-fg">{preview.orgName}</strong>.</>}>
        <Link href={`/login?email=${encodeURIComponent(preview.email)}&next=/home`} className="inline-flex h-11 items-center justify-center rounded-full bg-fg px-6 text-[14.5px] font-medium text-bg hover:opacity-90">
          Log in
        </Link>
      </AuthCard>
    );
  }
  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle={<>We sent a six-digit code to <strong className="text-fg">{sent.email}</strong>.</>}>
        <div className="grid gap-4">
          <OtpInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} disabled={busy} invalid={!!error} autoFocus label="Code from your email" />
          {sent.devCode && <Notice tone="accent" title="Development">Email isn&apos;t set up here, so your code is {sent.devCode}.</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
          <Button variant="primary" size="lg" loading={busy} disabled={code.length !== 6} onClick={() => void verify(code)}>
            Confirm
          </Button>
          <p className="text-center text-[13px] text-muted">
            {wait > 0 ? `You can ask for a new code in ${wait}s` : <button type="button" className="font-medium text-fg underline" onClick={() => void resend()}>Send a new code</button>}
          </p>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={`Join ${preview.orgName}`} subtitle={<>Create your account for {preview.email}. We&apos;ll email you a code to confirm it&apos;s you.</>}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void start(new FormData(e.currentTarget));
        }}
      >
        <Field label="Your name">{(p) => <input {...p} className="p-input" name="name" autoComplete="name" required autoFocus maxLength={100} />}</Field>
        <Field label="Password">{(p) => <PasswordInput id={p.id} name="password" autoComplete="new-password" strength />}</Field>
        <label className="flex items-start gap-2 text-[13px] text-muted">
          <input type="checkbox" name="terms" required className="mt-0.5" /> I agree to the terms of service and privacy policy.
        </label>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button variant="primary" size="lg" loading={busy} type="submit">
          Continue
        </Button>
        <button type="button" className="text-[13px] text-muted hover:text-fg" onClick={onBack}>
          Back
        </button>
      </form>
    </AuthCard>
  );
}
