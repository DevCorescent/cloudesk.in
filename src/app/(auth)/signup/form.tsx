"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthCard, PasswordInput } from "@/components/auth-form";
import { GithubButton } from "@/components/github-button";
import { Field, Notice } from "@/components/ui/primitives";
import { api, ApiClientError } from "@/lib/client/api";
import { safeNext } from "../login/form";

export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const providers = useQuery({ queryKey: ["auth-providers"], queryFn: () => api<{ github: boolean }>("/api/v1/auth/providers"), staleTime: 60_000 });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    setErrors({});
    try {
      await api("/api/v1/auth/signup", { method: "POST", body: { name: f.get("name"), email: f.get("email"), password: f.get("password") } });
      const next = params.get("next");
      router.replace(next ? safeNext(next) : "/welcome");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(err.fieldErrors());
        if (err.code !== "validation_failed") setError(err.message);
      } else setError("Could not create the account");
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Your website or online store, live in minutes. No card needed."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-fg underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {providers.data?.github && <GithubButton next={params.get("next") ? safeNext(params.get("next")) : "/welcome"} label="Sign up with GitHub" />}
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Name" error={errors.name?.[0]}>{(p) => <input {...p} className="p-input" name="name" autoComplete="name" required autoFocus />}</Field>
        <Field label="Work email" error={errors.email?.[0]}>{(p) => <input {...p} className="p-input" name="email" type="email" autoComplete="email" required />}</Field>
        <Field label="Password" hint="At least 10 characters, with a number or symbol." error={errors.password?.[0]}>
          {(p) => <PasswordInput id={p.id} name="password" autoComplete="new-password" strength invalid={p["aria-invalid"]} describedBy={p["aria-describedby"]} />}
        </Field>
        <button type="submit" className="p-cta mt-2 inline-flex items-center justify-center gap-2" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          Create account
        </button>
        <p className="text-center text-[12px] text-subtle">By continuing you agree to use Cloudesk responsibly.</p>
      </form>
    </AuthCard>
  );
}
