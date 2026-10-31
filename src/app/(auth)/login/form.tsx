"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, PartyPopper } from "lucide-react";
import { AuthCard, PasswordInput } from "@/components/auth-form";
import { GithubButton } from "@/components/github-button";
import { OtpInput, useCountdown } from "@/components/otp-input";
import { Button, Field, Input, Notice } from "@/components/ui/primitives";
import { api, ApiClientError } from "@/lib/client/api";
import { safeNextPath } from "@/lib/safe-next";

export function safeNext(next: string | null) {
  return safeNextPath(next);
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(params.get("error"));
  const [loading, setLoading] = useState(false);
  // "cookie": a GitHub sign-in whose challenge the server keeps in an HttpOnly cookie.
  const [challenge, setChallenge] = useState<string | null>(params.get("mfa") === "1" ? "cookie" : null);
  const [sso, setSso] = useState(params.get("sso") === "1");
  // Signing in with an emailed code instead of the password.
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [codeMode, setCodeMode] = useState(false);
  const welcome = params.get("welcome") === "1";
  async function onSso(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ url: string }>("/api/v1/auth/sso/start", { method: "POST", body: { email: new FormData(e.currentTarget).get("email"), next } });
      window.location.assign(r.url);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not start single sign-on");
      setLoading(false);
    }
  }
  const providers = useQuery({ queryKey: ["auth-providers"], queryFn: () => api<{ github: boolean }>("/api/v1/auth/providers"), staleTime: 60_000 });
  const next = safeNext(params.get("next"));

  const done = () => {
    router.replace(next);
    router.refresh();
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ mfaRequired?: boolean; challenge?: string }>("/api/v1/auth/login", { method: "POST", body: { email: f.get("email"), password: f.get("password") } });
      if (r.mfaRequired && r.challenge) {
        setChallenge(r.challenge);
        setLoading(false);
        return;
      }
      done();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not sign in");
      setLoading(false);
    }
  }

  async function onCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setLoading(true);
    setError(null);
    try {
      await api("/api/v1/auth/login/mfa", { method: "POST", body: challenge === "cookie" ? { code } : { challenge, code } });
      done();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not verify the code");
      if (err instanceof ApiClientError && /expired|Start again/.test(err.message)) setChallenge(null);
      setLoading(false);
    }
  }

  if (challenge) {
    return (
      <AuthCard title="Two-factor sign-in" subtitle="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
        <form onSubmit={onCode} className="grid gap-4" noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Code">{(p) => <Input {...p} name="code" inputMode="text" autoComplete="one-time-code" autoFocus required maxLength={20} placeholder="123 456" className="text-center font-mono text-lg tracking-[0.3em]" />}</Field>
          <Button type="submit" variant="primary" size="lg" loading={loading}>
            Verify
          </Button>
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setChallenge(null)}>
            Use a different account
          </button>
        </form>
      </AuthCard>
    );
  }

  if (codeMode) {
    return (
      <CodeSignIn
        email={email}
        setEmail={setEmail}
        onChallenge={(c) => (setCodeMode(false), setError(null), setChallenge(c))}
        onDone={done}
        onPassword={() => (setCodeMode(false), setError(null))}
      />
    );
  }

  if (sso) {
    return (
      <AuthCard title="Sign in with SSO" subtitle="Use your work email — you'll sign in with your company's identity provider.">
        <form onSubmit={onSso} className="grid gap-4" noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Work email">{(p) => <input {...p} className="p-input" name="email" type="email" autoComplete="email" required autoFocus />}</Field>
          <button type="submit" className="p-cta inline-flex items-center justify-center gap-2" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Continue
          </button>
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => (setSso(false), setError(null))}>
            Sign in with a password instead
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={
        <>
          New here?{" "}
          <Link href={`/start${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`} className="font-medium text-fg underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {welcome && (
        <div className="mb-5">
          <Notice tone="success" title="Your workspace is ready">
            <span className="inline-flex items-center gap-1.5">
              <PartyPopper className="size-3.5" /> Log in to start your free trial.
            </span>
          </Notice>
        </div>
      )}
      {providers.data?.github && <GithubButton next={next} />}
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Email">{(p) => <input {...p} className="p-input" name="email" type="email" autoComplete="email" required autoFocus={!email} value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">{(p) => <PasswordInput id={p.id} name="password" autoComplete="current-password" autoFocus={!!email} />}</Field>
        <div className="-mt-1 text-right">
          <Link href="/forgot-password" className="text-xs text-muted hover:text-fg">
            Forgot password?
          </Link>
        </div>
        <button type="submit" className="p-cta inline-flex items-center justify-center gap-2" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          Sign in
        </button>
        <div className="flex items-center justify-center gap-3 text-xs">
          <button type="button" className="text-muted hover:text-fg" onClick={() => (setCodeMode(true), setError(null))}>
            Email me a code instead
          </button>
          <span className="text-subtle" aria-hidden>
            ·
          </span>
          <button type="button" className="text-muted hover:text-fg" onClick={() => (setSso(true), setError(null))}>
            Sign in with SSO
          </button>
        </div>
      </form>
    </AuthCard>
  );
}

/** Sign in with a six-digit code sent to the address, instead of the password. */
function CodeSignIn({ email, setEmail, onChallenge, onDone, onPassword }: { email: string; setEmail: (v: string) => void; onChallenge: (challenge: string) => void; onDone: () => void; onPassword: () => void }) {
  const [sentAt, setSentAt] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const wait = useCountdown(sentAt + 30_000);
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy("send");
    setError(null);
    try {
      const r = await api<{ sent: boolean; devCode?: string }>("/api/v1/auth/login/code", { method: "POST", body: { email: email.trim() } });
      setSentAt(Date.now());
      setDevCode(r.devCode ?? null);
      setCode("");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not send the code");
    }
    setBusy(null);
  }
  async function verify(c: string) {
    setBusy("verify");
    setError(null);
    try {
      const r = await api<{ mfaRequired?: boolean; challenge?: string }>("/api/v1/auth/login/code/verify", { method: "POST", body: { email: email.trim(), code: c } });
      if (r.mfaRequired && r.challenge) return onChallenge(r.challenge);
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not verify the code");
      setCode("");
      setBusy(null);
    }
  }
  if (!sentAt) {
    return (
      <AuthCard title="Sign in with a code" subtitle="We'll email you a 6-digit code — no password needed.">
        <form onSubmit={send} className="grid gap-4" noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Email">{(p) => <input {...p} className="p-input" name="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <button type="submit" className="p-cta inline-flex items-center justify-center gap-2" disabled={busy !== null || !email.trim()}>
            {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : null}
            Email me a code
          </button>
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={onPassword}>
            Sign in with a password instead
          </button>
        </form>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Check your email"
      subtitle={
        <>
          If there&apos;s an account for <b className="font-semibold break-all text-fg">{email.trim()}</b>, a 6-digit code is on its way. It works for 10 minutes.
        </>
      }
    >
      <div className="grid gap-4">
        {devCode && (
          <p className="rounded-[12px] border border-dashed border-[var(--p-butter-ink)]/40 bg-[var(--p-butter)] px-3 py-2 text-[13px] text-[var(--p-butter-ink)]">
            Development: your code is <b className="font-mono tracking-[0.15em]">{devCode}</b>
          </p>
        )}
        <OtpInput value={code} onChange={(v) => (setCode(v), setError(null))} onComplete={(c) => void verify(c)} disabled={busy === "verify"} invalid={!!error} autoFocus label="6-digit code" describedBy={error ? "code-error" : undefined} />
        {error && (
          <p id="code-error" role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <button type="button" className="p-cta inline-flex items-center justify-center gap-2" disabled={code.length < 6 || busy !== null} onClick={() => void verify(code)}>
          {busy === "verify" ? <Loader2 className="size-4 animate-spin" /> : null}
          Sign in
        </button>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
          {wait > 0 ? (
            <span className="text-muted tabular-nums">Send a new code in {wait}s</span>
          ) : (
            <button type="button" className="text-muted hover:text-fg" disabled={busy !== null} onClick={() => void send()}>
              Send a new code
            </button>
          )}
          <span className="text-subtle" aria-hidden>
            ·
          </span>
          <button type="button" className="text-muted hover:text-fg" onClick={() => (setSentAt(0), setError(null))}>
            Change email
          </button>
          <span className="text-subtle" aria-hidden>
            ·
          </span>
          <button type="button" className="text-muted hover:text-fg" onClick={onPassword}>
            Use my password
          </button>
        </div>
      </div>
    </AuthCard>
  );
}
