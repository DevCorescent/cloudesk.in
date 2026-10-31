"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthCard } from "@/components/auth-form";
import { Button, Field, Input, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

export default function Page() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/api/v1/auth/forgot-password", { method: "POST", body: { email: new FormData(e.currentTarget).get("email") } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthCard title="Reset your password" subtitle="We will send a reset link if an account exists for this email." footer={<Link href="/login" className="hover:text-fg">Back to sign in</Link>}>
      {sent ? (
        <Notice tone="success" title="Check your inbox">
          If the address has an account, a reset link is on its way. It expires in one hour.
        </Notice>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Email">{(p) => <Input {...p} name="email" type="email" required autoFocus autoComplete="email" />}</Field>
          <Button type="submit" variant="primary" size="lg" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
