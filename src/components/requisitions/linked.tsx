"use client";

// A client's requisitions, shown on their CRM contact when Requisitions is on
// and open to the member: what's still owed and how far along it is.
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Section } from "@/components/crm/shared";
import { useSession } from "@/components/shell/session-context";
import { Badge } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { LIST_LABEL, type ListStatus } from "@/lib/requisitions/model";
import { visibleTo } from "@/lib/workspace/modules";

export function LinkedRequisitions({ contactId }: { contactId: string }) {
  const { org } = useSession();
  const on = visibleTo(org, "requisitions");
  const q = useQuery({ queryKey: ["requisitions", org.id, `contact?contactId=${contactId}`], queryFn: () => api<{ lists: { id: string; number: string; title: string; status: ListStatus; got: number; of: number }[] }>(`/api/v1/orgs/${org.id}/requisitions/contact?contactId=${contactId}`), enabled: on, retry: false });
  if (!on || q.isError || !q.data?.lists.length) return null;
  return (
    <Section title={`Requisitions · ${q.data.lists.length}`}>
      <ul className="space-y-1.5 text-[13px]">
        {q.data.lists.slice(0, 8).map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2">
            <Link href={`/requisitions/lists/${l.id}`} className="min-w-0 truncate hover:underline">{l.number} · {l.title}</Link>
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted tabular-nums">{l.got}/{l.of}<Badge tone={l.status === "completed" ? "success" : l.status === "active" ? "accent" : "neutral"}>{LIST_LABEL[l.status]}</Badge></span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
