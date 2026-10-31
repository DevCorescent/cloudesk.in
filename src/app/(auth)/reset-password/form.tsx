"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthCard } from "@/components/auth-form";
import { Button, Field, Input, Notice } from "@/components/ui/primitives";
import { api, ApiClientError } from "@/lib/client/api";

export function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [loading, setLoading] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/api/v1/auth/reset-password", { method: "POST", body: { token, password: new FormData(e.currentTarget).get("password") } });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "validation_failed") setFieldError(err.fieldErrors().password?.[0]);
      else setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthCard title="Choose a new password" subtitle="All other sessions will be signed out.">
      {done ? (
        <Notice tone="success" title="Password updated" action={<Link href="/login" className="text-[13px] font-medium text-fg">Sign in</Link>} />
      ) : !token ? (
        <Notice tone="danger">This reset link is missing its token. Request a new one.</Notice>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="New password" hint="At least 10 characters, with a number or symbol." error={fieldError}>
            {(p) => <Input {...p} name="password" type="password" required autoFocus autoComplete="new-password" />}
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={loading}>
            Update password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
