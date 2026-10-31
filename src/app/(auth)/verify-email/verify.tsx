"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "@/components/auth-form";
import { Notice, Spinner } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

export function Verify() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<{ status: "pending" | "ok" | "error"; message?: string }>(() => (token ? { status: "pending" } : { status: "error", message: "This link is missing its token." }));
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    api("/api/v1/auth/verify-email", { method: "POST", body: { token } })
      .then(() => setState({ status: "ok" }))
      .catch((e) => setState({ status: "error", message: errorMessage(e) }));
  }, [token]);
  return (
    <AuthCard title="Email verification">
      {state.status === "pending" && <Spinner label="Verifying" />}
      {state.status === "ok" && <Notice tone="success" title="Your email is verified" action={<Link href="/home" className="text-[13px] font-medium text-fg">Continue</Link>} />}
      {state.status === "error" && <Notice tone="danger" title="Could not verify">{state.message}</Notice>}
    </AuthCard>
  );
}
