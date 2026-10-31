"use client";

// Companies: the accounts you sell to, with their people, deals and the whole
// team's timeline in one place.
import { ShareToChatButton } from "@/components/chat/share";
import { EmailButton } from "@/components/mail/compose-provider";
import { LinkedDocuments } from "@/components/documents/linked";
import { ArrowLeft, Building2, Globe, MapPin, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/overlays";
import { Button, EmptyState, ErrorState, Input, PageHeader, Skeleton, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { CompanyDialog, ContactDialog, DealDialog, type CompanyRow } from "./dialogs";
import { Avatar, LifecycleBadge, Score, Section, Tag, ago, customText, ownerName, useCrm, useCrmAction, useCrmQuery, useShortMoney, type Activity, type Contact, type Deal } from "./shared";
import { Composer, Timeline } from "./timeline";

type Row = CompanyRow & { contacts: number; openDeals: number; pipeline: number; won: number; createdAt: string };

export function CompaniesView() {
  const { meta, go } = useCrm();
  const short = useShortMoney();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const list = useCrmQuery<{ total: number; companies: Row[] }>(`companies?q=${encodeURIComponent(q)}&page=${page}`, { keepPrevious: true });
  const rows = list.data?.companies ?? [];
  return (
    <div>
      <PageHeader
        title="Companies"
        description={list.data ? `${list.data.total.toLocaleString("en-IN")} compan${list.data.total === 1 ? "y" : "ies"}` : "The businesses your contacts work at."}
        actions={meta.me.write ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Company</Button> : undefined}
      />
      <Input aria-label="Find a company" className="mb-3 max-w-sm" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Name, domain or city" />
      {!list.data ? (
        <Skeleton className="h-64 rounded-[20px]" />
      ) : !rows.length ? (
        <EmptyState icon={<Building2 />} title={q ? "No company matches" : "No companies yet"} description="Companies are created when you type one on a contact, or add one here. People with a matching work email join automatically." action={meta.me.write && !q ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add a company</Button> : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 text-right font-medium">People</th>
                <th className="px-4 py-2.5 text-right font-medium">Open deals</th>
                <th className="px-4 py-2.5 text-right font-medium">Won</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.id} onClick={() => go(`companies/${c.id}`)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={c.name} size={30} square />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="truncate text-[12px] text-muted">{[c.industry, c.city, c.domain].filter(Boolean).join(" · ") || "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.contacts}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.openDeals ? (
                      <>
                        {c.openDeals} <span className="text-muted">· {short(c.pipeline)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.won ? short(c.won) : "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{ownerName(meta, c.ownerId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.total > 50 && (
            <div className="flex justify-end gap-2 border-t border-border px-4 py-2.5">
              <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" disabled={page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
      {adding && <CompanyDialog onClose={() => setAdding(false)} onSaved={(c) => go(`companies/${c.id}`)} />}
    </div>
  );
}

export function CompanyPage({ id }: { id: string }) {
  const { meta, go } = useCrm();
  const short = useShortMoney();
  const q = useCrmQuery<{ company: CompanyRow & { createdAt: string }; contacts: Contact[]; deals: (Deal & { stage: string })[]; activities: Activity[] }>(`companies/${id}`);
  const [editing, setEditing] = useState(false);
  const [person, setPerson] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const del = useCrmAction(() => ({ path: `companies/${id}`, method: "DELETE" }), { success: "Company deleted", onDone: () => go("companies") });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { company: c, contacts, deals, activities } = q.data;
  const open = deals.filter((d) => d.status === "open");
  const won = deals.filter((d) => d.status === "won");
  const fields = meta.fields.filter((f) => f.entity === "company");
  return (
    <div>
      <Link href="/crm/companies" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> Companies
      </Link>
      <header className="mb-5 flex flex-wrap items-start gap-4 rounded-[24px] border border-border bg-surface p-5 shadow-sm">
        <Avatar name={c.name} size={56} square />
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em]">{c.name}</h1>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
            {c.industry && <span>{c.industry}</span>}
            {c.size && <span>{c.size} people</span>}
            {c.domain && (
              <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
                <Globe className="size-3.5" /> {c.domain}
              </a>
            )}
            {c.phone && (
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-fg">
                <Phone className="size-3.5" /> {c.phone}
              </a>
            )}
            {(c.city || c.country) && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" /> {[c.city, c.country].filter(Boolean).join(", ")}
              </span>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
            <span>
              <b className="tabular-nums">{contacts.length}</b> <span className="text-muted">people</span>
            </span>
            <span>
              <b className="tabular-nums">{short(open.reduce((a, d) => a + d.value, 0))}</b> <span className="text-muted">open in {open.length} deal{open.length === 1 ? "" : "s"}</span>
            </span>
            <span>
              <b className="tabular-nums text-success">{short(won.reduce((a, d) => a + d.value, 0))}</b> <span className="text-muted">won</span>
            </span>
          </div>
        </div>
        <ShareToChatButton card={{ kind: "companies", id: c.id, title: c.name, sub: [c.industry, c.city].filter(Boolean).join(" · "), link: `/crm/companies/${c.id}`, module: "Company", fields: [{ label: "Domain", value: c.domain }, { label: "Size", value: c.size }, { label: "Phone", value: c.phone }, { label: "People", value: contacts.length }] }} />
        {contacts.some((x) => x.email && !x.doNotContact) && <EmailButton to={contacts.filter((x) => !x.doNotContact)} title={`Email ${c.name}`} label={contacts.filter((x) => x.email && !x.doNotContact).length > 1 ? "Email everyone" : "Email"} />}
        {meta.me.write && (
          <div className="flex gap-2">
            <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            {meta.me.manage && <Button size="sm" variant="ghost" aria-label="Delete company" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} />}
          </div>
        )}
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-4">
          <Composer target={{ companyId: c.id }} />
          <Timeline items={activities} showWhat />
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <Section title={`People · ${contacts.length}`} action={meta.me.write ? <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setPerson(true)}>Person</Button> : undefined}>
            {!contacts.length ? (
              <p className="text-[13px] text-muted">No one yet.</p>
            ) : (
              <ul className="grid gap-1">
                {contacts.map((p) => (
                  <li key={p.id}>
                    <Link href={`/crm/contacts/${p.id}`} className="flex items-center gap-2.5 rounded-[12px] p-1.5 hover:bg-surface-2">
                      <Avatar name={p.name || p.email} size={30} />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[13px]">{p.name || p.email}</b>
                        <span className="block truncate text-[11.5px] text-muted">{p.title || p.email || p.phone}</span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <LifecycleBadge value={p.lifecycle} />
                        <Score value={p.score} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Deals" action={meta.me.write ? <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setDealing(true)}>Deal</Button> : undefined}>
            {!deals.length ? (
              <p className="text-[13px] text-muted">No deals yet.</p>
            ) : (
              <ul className="grid gap-2">
                {deals.map((d) => (
                  <li key={d.id}>
                    <Link href={`/crm/deals/${d.id}`} className="block rounded-[14px] border border-border px-3 py-2 hover:bg-surface-2">
                      <p className="flex justify-between gap-2 text-[13px] font-semibold">
                        <span className="truncate">{d.title}</span>
                        <span className="tabular-nums">{short(d.value)}</span>
                      </p>
                      <p className={cx("text-[12px]", d.status === "won" ? "text-success" : d.status === "lost" ? "text-danger" : "text-muted")}>{d.status === "open" ? `${d.stage} · ${ago(d.updatedAt)}` : d.status === "won" ? "Won" : "Lost"}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="About">
            <dl className="grid gap-2 text-[13px]">
              <div className="grid grid-cols-[96px_1fr] gap-2">
                <dt className="text-muted">Owner</dt>
                <dd>{ownerName(meta, c.ownerId)}</dd>
              </div>
              {c.gstin && (
                <div className="grid grid-cols-[96px_1fr] gap-2">
                  <dt className="text-muted">GSTIN</dt>
                  <dd className="font-mono text-[12.5px]">{c.gstin}</dd>
                </div>
              )}
              {c.address && (
                <div className="grid grid-cols-[96px_1fr] gap-2">
                  <dt className="text-muted">Address</dt>
                  <dd>{c.address}</dd>
                </div>
              )}
              {fields.map((f) => (
                <div key={f.id} className="grid grid-cols-[96px_1fr] gap-2">
                  <dt className="text-muted">{f.label}</dt>
                  <dd>{customText(f, c.custom?.[f.key])}</dd>
                </div>
              ))}
            </dl>
            {c.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            )}
            {c.notes && <p className="mt-3 rounded-[12px] bg-surface-2 px-3 py-2 text-[13px] whitespace-pre-wrap">{c.notes}</p>}
          </Section>
          <LinkedDocuments type="crm_company" id={c.id} name={c.name} />
        </div>
      </div>
      {editing && <CompanyDialog init={c} onClose={() => setEditing(false)} />}
      {person && <ContactDialog init={{ company: c.name }} onClose={() => setPerson(false)} />}
      {dealing && <DealDialog company={{ id: c.id, label: c.name }} onClose={() => setDealing(false)} onSaved={(d) => go(`deals/${d.id}`)} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive title={`Delete ${c.name}?`} description="Its people and deals stay, just without a company." confirmLabel="Delete" />
    </div>
  );
}
