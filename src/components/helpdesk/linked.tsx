"use client";

// A customer's support tickets, shown on their CRM contact when the Helpdesk
// is on and open to the member.
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Section } from "@/components/crm/shared";
import { useSession } from "@/components/shell/session-context";
import { Badge } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { STATUS_LABEL, type Status } from "@/lib/helpdesk/model";
import { visibleTo } from "@/lib/workspace/modules";

export function LinkedTickets({ contactId, email }: { contactId: string; email?: string }) {
  const { org } = useSession();
  const on = visibleTo(org, "helpdesk");
  const qs = new URLSearchParams({ view: "all", contactId, ...(email ? { email } : {}) }).toString();
  const q = useQuery({ queryKey: ["helpdesk", org.id, `tickets?${qs}`], queryFn: () => api<{ tickets: { id: string; number: string; subject: string; status: Status }[] }>(`/api/v1/orgs/${org.id}/helpdesk/tickets?${qs}`), enabled: on, retry: false });
  if (!on || q.isError || !q.data?.tickets.length) return null;
  return (
    <Section title={`Support tickets · ${q.data.tickets.length}`}>
      <ul className="space-y-1.5 text-[13px]">
        {q.data.tickets.slice(0, 8).map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2">
            <Link href={`/helpdesk/tickets/${t.id}`} className="min-w-0 truncate hover:underline">{t.number} · {t.subject}</Link>
            <Badge tone={t.status === "resolved" || t.status === "closed" ? "success" : "accent"}>{STATUS_LABEL[t.status]}</Badge>
          </li>
        ))}
      </ul>
    </Section>
  );
}
