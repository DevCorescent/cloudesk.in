"use client";

// One person, everything about them: details and stage, the timeline, their
// deals and company, and what they've bought, booked or been invoiced for
// anywhere in Cloudesk.
import { ShareToChatButton } from "@/components/chat/share";
import { EmailButton } from "@/components/mail/compose-provider";
import { LinkedTickets } from "@/components/helpdesk/linked";
import { LinkedRequisitions } from "@/components/requisitions/linked";
import { LinkedDocuments } from "@/components/documents/linked";
import { ArrowLeft, Ban, Briefcase, Building2, CalendarDays, Copy, Mail, MessageCircle, MoreHorizontal, Pencil, Phone, Plus, Receipt, Repeat, ShoppingBag, Trash2, UtensilsCrossed, FileText } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ConfirmDialog, Menu } from "@/components/ui/overlays";
import { Button, ErrorState, Select, Skeleton, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { LEAD_STATUS, LEAD_STATUS_LABEL, LIFECYCLE, LIFECYCLE_LABEL, SOURCE_LABEL, type Lifecycle } from "@/lib/crm/model";
import { formatPrice } from "@/lib/store/money";
import { EnrollDialog } from "./contacts";
import { ContactDialog, DealDialog, TaskDialog } from "./dialogs";
import { Avatar, LifecycleBadge, OwnerSelect, Score, Section, Tag, ago, customText, dateLabel, ownerName, useCrm, useCrmAction, useCrmParts, useCrmQuery, useShortMoney, type Activity, type Contact, type Deal } from "./shared";
import { Composer, Timeline } from "./timeline";

type Linked = {
  orders: { id: string; projectId: string; project: string; number: number; total: number; currency: string; status: string; paid: boolean; createdAt: string }[];
  invoices: { id: string; ownerId: string; book: boolean; type: string; number: string; total: number; amountPaid: number; currency: string; status: string; issueDate: string }[];
  bookings: { id: string; projectId: string; project: string; service: string; startsAt: string; status: string; amount: number; currency: string; paid: boolean }[];
  visits: { projectId: string; project: string; visits: number; spend: number; points: number; lastVisitAt: string | null }[];
  forms: { id: string; projectId: string; project: string; formId: string; createdAt: string; data: Record<string, unknown> }[];
  totals: { currency: string; paid: number }[];
};
type View = {
  contact: Contact;
  company: { id: string; name: string; domain: string; industry: string; city: string } | null;
  deals: (Deal & { stage: string; stageKind: string })[];
  activities: Activity[];
  enrollments: { id: string; sequenceId: string; sequence: string; status: string; step: number; totalSteps: number; nextAt: string | null; stopReason: string }[];
  linked: Linked;
  duplicates: { id: string; name: string; email: string; phone: string }[];
};
const DOC_PATH: Record<string, string> = { invoice: "invoices", quote: "quotes", proforma: "proforma", credit_note: "credit-notes" };

export function ContactPage({ id }: { id: string }) {
  const { meta, go } = useCrm();
  const part = useCrmParts();
  const q = useCrmQuery<View>(`contacts/${id}`);
  const short = useShortMoney();
  const [editing, setEditing] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [tasking, setTasking] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const save = useCrmAction<Partial<Contact>>((b) => ({ path: `contacts/${id}`, method: "PUT", body: b }), { success: "Saved" });
  const del = useCrmAction(() => ({ path: `contacts/${id}`, method: "DELETE" }), { success: "Contact deleted", onDone: () => go("contacts") });
  const merge = useCrmAction<string[]>((others) => ({ path: "contacts/merge", body: { keepId: id, otherIds: others } }), { success: "Merged" });
  const stop = useCrmAction<string>((eid) => ({ path: `enrollments/${eid}/stop` }), { success: "Sequence stopped" });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { contact: c, company, deals, activities, enrollments, linked, duplicates } = q.data;
  const w = meta.me.write;
  const fields = meta.fields.filter((f) => f.entity === "contact");
  const wa = c.phone.replace(/\D/g, "");
  const waNumber = wa.length === 10 ? `91${wa}` : wa;
  const openDeals = deals.filter((d) => d.status === "open");
  const step = LIFECYCLE.indexOf(c.lifecycle);
  return (
    <div>
      <Link href="/crm/contacts" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> Contacts
      </Link>
      <header className="mb-5 rounded-[24px] border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={c.name || c.email || c.phone} size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] leading-tight font-semibold tracking-[-0.02em]">{c.name || c.email || c.phone}</h1>
            <p className="mt-0.5 truncate text-[13.5px] text-muted">
              {[c.title, company?.name].filter(Boolean).join(" at ") || "—"}
              {company && (
                <Link href={`/crm/companies/${company.id}`} className="ml-1.5 text-[12px] underline">
                  view company
                </Link>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <LifecycleBadge value={c.lifecycle} />
              <Score value={c.score} />
              {c.doNotContact && <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-danger-soft px-2 text-[11.5px] font-semibold text-danger"><Ban className="size-3" /> Do not contact</span>}
              {c.tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.phone && (
              <a href={`tel:${c.phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
                <Phone className="size-3.5" /> Call
              </a>
            )}
            {waNumber.length >= 10 && (
              <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
                <MessageCircle className="size-3.5" /> WhatsApp
              </a>
            )}
            {c.email && !c.doNotContact && <EmailButton to={[c]} title={`Email ${c.name}`} label="Email" />}
            <ShareToChatButton card={{ kind: "contacts", id: c.id, title: c.name, sub: [c.title, c.email].filter(Boolean).join(" · "), link: `/crm/contacts/${c.id}`, module: "CRM contact", fields: [{ label: "Stage", value: c.lifecycle }, { label: "Phone", value: c.phone }, { label: "Score", value: c.score }] }} />
            {c.email && (
              <a href={`mailto:${c.email}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
                <Mail className="size-3.5" /> Mail app
              </a>
            )}
            {w && (
              <>
                <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Menu
                  label="More"
                  trigger={(p) => <Button {...p} size="sm" aria-label="More" icon={<MoreHorizontal className="size-4" />} />}
                  items={[
                    ...(part("deals") ? [{ label: "New deal", icon: <Briefcase className="size-4" />, onSelect: () => setDealing(true) }] : []),
                    { label: "New task", icon: <Plus className="size-4" />, onSelect: () => setTasking(true) },
                    ...(part("sequences") ? [{ label: "Add to a sequence", icon: <Repeat className="size-4" />, onSelect: () => setEnrolling(true) }] : []),
                    { label: c.doNotContact ? "Allow contact again" : "Mark do not contact", icon: <Ban className="size-4" />, onSelect: () => save.mutate({ doNotContact: !c.doNotContact }) },
                    ...(meta.me.manage ? ["separator" as const, { label: "Delete contact", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDeleting(true) }] : []),
                  ]}
                />
              </>
            )}
          </div>
        </div>
        {/* The lifecycle, as a row of steps you can click. */}
        <ol className="mt-5 grid grid-cols-3 gap-1 sm:grid-cols-6" aria-label="Lifecycle stage">
          {LIFECYCLE.filter((l) => l !== "other").map((l, i) => {
            const on = l === c.lifecycle;
            const past = step >= 0 && i < step && c.lifecycle !== "other";
            return (
              <li key={l}>
                <button type="button" disabled={!w || on} onClick={() => save.mutate({ lifecycle: l as Lifecycle })} aria-current={on ? "step" : undefined} className={cx("h-8 w-full rounded-[10px] px-2 text-[12px] font-semibold transition-colors", on ? "bg-fg text-bg" : past ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted hover:text-fg disabled:hover:text-muted")}>
                  {LIFECYCLE_LABEL[l]}
                </button>
              </li>
            );
          })}
        </ol>
      </header>

      {duplicates.length > 0 && meta.me.manage && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[16px] bg-warning-soft px-4 py-3 text-[13px]">
          <Copy className="size-4" />
          <span className="flex-1">
            Looks like the same person as {duplicates.map((d) => d.name || d.email || d.phone).join(", ")}.
          </span>
          <Button size="sm" loading={merge.isPending} onClick={() => merge.mutate(duplicates.map((d) => d.id))}>
            Merge into this one
          </Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-4">
          <Composer target={{ contactId: c.id, email: c.email, doNotContact: c.doNotContact }} />
          <Timeline items={activities} />
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <Section title="Details">
            <dl className="grid gap-2.5 text-[13px]">
              <Row label="Email">{c.email ? <a className="break-all underline-offset-2 hover:underline" href={`mailto:${c.email}`}>{c.email}</a> : "—"}</Row>
              <Row label="Phone">{c.phone ? <a className="hover:underline" href={`tel:${c.phone}`}>{c.phone}</a> : "—"}</Row>
              <Row label="Owner">{w ? <OwnerSelect value={c.ownerId} onChange={(v) => save.mutate({ ownerId: v })} /> : ownerName(meta, c.ownerId)}</Row>
              {c.lifecycle === "lead" && (
                <Row label="Lead status">
                  {w ? (
                    <Select aria-label="Lead status" value={c.leadStatus} onChange={(e) => save.mutate({ leadStatus: e.target.value })}>
                      {LEAD_STATUS.map((l) => (
                        <option key={l} value={l}>
                          {LEAD_STATUS_LABEL[l]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    LEAD_STATUS_LABEL[c.leadStatus as (typeof LEAD_STATUS)[number]]
                  )}
                </Row>
              )}
              <Row label="Source">{SOURCE_LABEL[c.source] ?? c.source}</Row>
              <Row label="Location">{[c.city, c.country].filter(Boolean).join(", ") || "—"}</Row>
              <Row label="Marketing">{c.marketing ? "Agreed" : "No"}</Row>
              {fields.map((f) => (
                <Row key={f.id} label={f.label}>
                  {customText(f, c.custom?.[f.key])}
                </Row>
              ))}
              <Row label="Last activity">{ago(c.lastActivityAt)}</Row>
              <Row label="Added">{dateLabel(c.createdAt, { day: "numeric", month: "short", year: "numeric" })}</Row>
            </dl>
          </Section>
          {enrollments.length > 0 && part("sequences") && (
            <Section title="Sequences">
              <ul className="grid gap-2">
                {enrollments.map((e) => (
                  <li key={e.id} className="rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px]">
                    <Link href={`/crm/sequences/${e.sequenceId}`} className="font-semibold hover:underline">
                      {e.sequence}
                    </Link>
                    <p className="text-muted">
                      {e.status === "active" ? `Step ${e.step + 1} of ${e.totalSteps}${e.nextAt ? ` · next ${ago(e.nextAt)}` : ""}` : e.status === "finished" ? "Finished" : `Stopped — ${e.stopReason}`}
                    </p>
                    {e.status === "active" && w && (
                      <button type="button" onClick={() => stop.mutate(e.id)} className="mt-1 text-[12px] font-medium text-danger">
                        Stop
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {part("deals") && <Section title={`Deals${openDeals.length ? ` · ${short(openDeals.reduce((a, d) => a + d.value, 0))} open` : ""}`} action={w ? <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setDealing(true)}>Deal</Button> : undefined}>
            {!deals.length ? (
              <p className="text-[13px] text-muted">No deals yet.</p>
            ) : (
              <ul className="grid gap-2">
                {deals.map((d) => (
                  <li key={d.id}>
                    <Link href={`/crm/deals/${d.id}`} className="block rounded-[14px] border border-border px-3 py-2.5 hover:bg-surface-2">
                      <p className="flex items-center justify-between gap-2 text-[13.5px] font-semibold">
                        <span className="truncate">{d.title}</span>
                        <span className="tabular-nums">{short(d.value)}</span>
                      </p>
                      <p className={cx("text-[12px]", d.status === "won" ? "text-success" : d.status === "lost" ? "text-danger" : "text-muted")}>
                        {d.status === "open" ? d.stage : d.status === "won" ? "Won" : `Lost — ${d.lostReason}`}
                        {d.expectedClose && d.status === "open" ? ` · closes ${dateLabel(d.expectedClose)}` : ""}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>}
          {company && (
            <Section title="Company">
              <Link href={`/crm/companies/${company.id}`} className="flex items-center gap-3 rounded-[14px] p-1 hover:bg-surface-2">
                <Avatar name={company.name} size={36} square />
                <span className="min-w-0">
                  <b className="block truncate text-[13.5px]">{company.name}</b>
                  <span className="block truncate text-[12px] text-muted">{[company.industry, company.city, company.domain].filter(Boolean).join(" · ") || "—"}</span>
                </span>
              </Link>
            </Section>
          )}
          <LinkedTickets contactId={c.id} email={c.email} />
          <LinkedRequisitions contactId={c.id} />
          <LinkedDocuments type="crm_contact" id={c.id} name={c.name || c.email} />
          <AcrossCloudesk linked={linked} />
        </div>
      </div>
      {editing && <ContactDialog init={{ ...c, company: company?.name ?? "" }} onClose={() => setEditing(false)} />}
      {dealing && <DealDialog contact={{ id: c.id, label: c.name || c.email }} company={company ? { id: company.id, label: company.name } : null} onClose={() => setDealing(false)} onSaved={(d) => go(`deals/${d.id}`)} />}
      {tasking && <TaskDialog contact={{ id: c.id, label: c.name || c.email }} onClose={() => setTasking(false)} />}
      {enrolling && <EnrollDialog target={{ ids: [c.id] }} count={1} onClose={() => setEnrolling(false)} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive title={`Delete ${c.name || c.email}?`} description="Their timeline goes too. Deals stay, without a contact. Orders, invoices and bookings elsewhere aren't touched." confirmLabel="Delete" />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

/** Orders, invoices, bookings, visits and forms from the rest of the workspace. */
function AcrossCloudesk({ linked }: { linked: Linked }) {
  const any = linked.orders.length + linked.invoices.length + linked.bookings.length + linked.visits.length + linked.forms.length;
  return (
    <Section title="Across Cloudesk">
      {linked.totals.length > 0 && (
        <div className="mb-3 rounded-[14px] bg-success-soft px-3 py-2.5">
          <p className="text-[11.5px] font-medium text-success">Paid to you, all time</p>
          <p className="text-[20px] font-semibold tracking-[-0.02em] tabular-nums">{linked.totals.map((t) => formatPrice(t.paid, t.currency)).join(" + ")}</p>
        </div>
      )}
      {!any ? (
        <p className="text-[13px] text-muted">No orders, invoices, bookings or form entries with this email or phone yet.</p>
      ) : (
        <ul className="grid gap-1.5 text-[12.5px]">
          {linked.orders.map((o) => (
            <Item key={o.id} icon={<ShoppingBag />} href={`/projects/${o.projectId}/store/orders/${o.id}`} title={`Order #${o.number}`} sub={`${o.project} · ${dateLabel(o.createdAt)}`} right={formatPrice(o.total, o.currency)} tone={o.paid ? "good" : undefined} />
          ))}
          {linked.invoices.map((i) => (
            <Item key={i.id} icon={i.type === "invoice" ? <Receipt /> : <FileText />} href={i.book ? `/finance/${i.ownerId}/${DOC_PATH[i.type] ?? "invoices"}/${i.id}` : `/projects/${i.ownerId}/invoicing/${DOC_PATH[i.type] ?? "invoices"}/${i.id}`} title={`${i.type === "quote" ? "Quote" : i.type === "credit_note" ? "Credit note" : i.type === "proforma" ? "Proforma" : "Invoice"} ${i.number || ""}`} sub={`${i.status} · ${dateLabel(i.issueDate)}`} right={formatPrice(i.total, i.currency)} tone={i.status === "paid" ? "good" : undefined} />
          ))}
          {linked.bookings.map((b) => (
            <Item key={b.id} icon={<CalendarDays />} title={b.service} sub={`${b.project} · ${dateLabel(b.startsAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · ${b.status}`} right={b.amount ? formatPrice(b.amount, b.currency) : ""} tone={b.paid ? "good" : undefined} />
          ))}
          {linked.visits.map((v) => (
            <Item key={v.projectId} icon={<UtensilsCrossed />} title={`${v.visits} visit${v.visits === 1 ? "" : "s"} · ${v.project}`} sub={`${v.points} points · last ${ago(v.lastVisitAt)}`} right={formatPrice(v.spend, "INR")} tone="good" />
          ))}
          {linked.forms.map((f) => (
            <Item key={f.id} icon={<Building2 />} title={`Form on ${f.project}`} sub={dateLabel(f.createdAt)} right="" />
          ))}
        </ul>
      )}
    </Section>
  );
}

function Item({ icon, title, sub, right, href, tone }: { icon: ReactNode; title: string; sub: string; right: string; href?: string; tone?: "good" }) {
  const inner = (
    <>
      <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-surface-2 text-muted [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <b className="block truncate font-medium">{title}</b>
        <span className="block truncate text-muted">{sub}</span>
      </span>
      {right && <span className={cx("shrink-0 font-semibold tabular-nums", tone === "good" && "text-success")}>{right}</span>}
    </>
  );
  return <li>{href ? <Link href={href} className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 hover:bg-surface-2">{inner}</Link> : <div className="flex items-center gap-2.5 px-1.5 py-1.5">{inner}</div>}</li>;
}
