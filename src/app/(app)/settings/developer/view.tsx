"use client";

import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { Badge, Card, EmptyState, ErrorState, Notice, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";

type Email = { id: string; subject: string; body: string; createdAt: string; transport: string; status: string; error: string | null };

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} className="break-all text-accent underline">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function DeveloperView() {
  const q = useQuery({ queryKey: ["outbox"], queryFn: () => api<{ provider: string; providerName: string; emails: Email[] }>("/api/v1/auth/outbox") });
  return (
    <div className="grid gap-4">
      {q.data && (
        <Notice tone={q.data.provider === "outbox" ? "warning" : "success"} title={q.data.provider === "outbox" ? "Mail outbox" : `Email is delivered with ${q.data.providerName}`}>
          {q.data.provider === "outbox"
            ? "No email provider is configured, so messages for your address are recorded here instead of being delivered. The platform administrator can connect Resend, Postmark, SendGrid or any SMTP server (see .env.example)."
            : "Messages sent to your address are listed below with their delivery status. Temporary failures are retried automatically."}
        </Notice>
      )}
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : q.data.emails.length === 0 ? (
        <Card><EmptyState icon={<Mail className="size-4" />} title="No messages" /></Card>
      ) : (
        q.data.emails.map((e) => (
          <Card key={e.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                {e.subject}
                {e.transport !== "outbox" && <Badge tone={e.status === "sent" ? "success" : e.status === "failed" ? "danger" : "warning"}>{e.status}</Badge>}
              </h3>
              <span className="text-xs text-subtle">{dateTime(e.createdAt)}</span>
            </div>
            {e.error && <p className="mt-1 text-xs text-danger">{e.error}</p>}
            <p className="mt-2 text-[13px] whitespace-pre-wrap text-muted">
              <Linkified text={e.body} />
            </p>
          </Card>
        ))
      )}
    </div>
  );
}
