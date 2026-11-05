"use client";

// The parts of Settings → Billing that describe where the workspace stands:
// the plan and its dates, what it uses against its limits, invoices and the
// history of every change.
import { moduleById, type ModuleId } from "@/lib/workspace/modules";
import { AlertTriangle, CalendarClock, CheckCircle2, FileText, Gift, Layers, Receipt, Sparkles, Undo2, Users, Wallet, Globe, AppWindow } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/overlays";
import { Badge, Button, Card, cx, EmptyState } from "@/components/ui/primitives";
import { money, taxOf } from "@/lib/billing/catalog";
import { timeAgo } from "@/lib/client/format";
import { invoiceStatus, invoiceTone } from "./invoice-sheet";
import { day, daysUntil, eventText, intervalWord, isFuture, isUnlimited, shareLeft, perWord, plural, shortDay, stateBadge, type Invoice, type Limit, type Overview } from "./types";

// ─── Hero ───────────────────────────────────────────────────────────────────

function Progress({ value, tone = "fg" }: { value: number; tone?: "fg" | "warning" | "danger" | "accent" }) {
  const bg = { fg: "bg-fg", warning: "bg-warning", danger: "bg-danger", accent: "bg-accent" }[tone];
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className={cx("h-full rounded-full transition-[width] duration-700", bg)} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Hero({ o, onPay, paying, onCancel, onResume, busy, onChoose, onView }: { o: Overview; onPay: (inv: Invoice) => void; paying: string | null; onCancel: () => void; onResume: () => void; busy: boolean; onChoose: () => void; onView: (inv: Invoice) => void }) {
  const s = o.subscription!;
  const badge = stateBadge(o);
  const cur = s.currency;
  const trialPlan = s.planId === "trial";
  const open = o.invoices.filter((i) => i.status === "open").sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime());
  const next = open[0];
  const [confirm, setConfirm] = useState(false);

  // The bar: days of the trial or of the paid period.
  let bar: ReactNode = null;
  if (o.state === "trial" && s.trialEndsAt) {
    const left = o.stats.trialDaysLeft ?? daysUntil(s.trialEndsAt) ?? 0;
    const total = Math.max(1, o.stats.trialDays);
    bar = (
      <div className="grid gap-1.5">
        <div className="flex justify-between text-[12.5px]">
          <span className="font-medium">{left === 0 ? "Your trial ends today" : `${plural(left, "day")} left of ${total}`}</span>
          <span className="text-muted">Trial ends {day(s.trialEndsAt)}</span>
        </div>
        <Progress value={left / total} tone={left <= 3 ? "warning" : "accent"} />
      </div>
    );
  } else if ((o.state === "active" || o.state === "canceling") && s.currentPeriodStart && s.currentPeriodEnd && !s.complimentary) {
    const start = new Date(s.currentPeriodStart).getTime();
    const end = new Date(s.currentPeriodEnd).getTime();
    const left = daysUntil(s.currentPeriodEnd) ?? 0;
    bar = (
      <div className="grid gap-1.5">
        <div className="flex justify-between text-[12.5px]">
          <span className="font-medium">{plural(left, "day")} left this {s.interval}</span>
          <span className="text-muted">
            {day(s.currentPeriodStart)} – {day(s.currentPeriodEnd)}
          </span>
        </div>
        <Progress value={shareLeft(start, end)} tone={o.state === "canceling" ? "warning" : "fg"} />
      </div>
    );
  } else if (o.state === "grace") {
    bar = (
      <div className="flex items-start gap-2 rounded-[12px] bg-warning-soft px-3 py-2 text-[12.5px]">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <span>
          Your renewal hasn&apos;t been paid. Everything keeps working until <b className="font-semibold">{day(s.graceEndsAt)}</b>; after that {o.free ? "the workspace moves to the Free plan (work in other features is kept, locked)" : "the workspace becomes read-only"} until it&apos;s paid.
        </span>
      </div>
    );
  } else if (o.state === "expired") {
    bar = (
      <div className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-3 py-2 text-[12.5px]">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
        <span>This workspace is read-only: you can sign in, look around and export, but not add or change anything. Nothing has been deleted — choose a plan to switch everything back on.</span>
      </div>
    );
  } else if (s.complimentary) {
    bar = (
      <div className="flex items-start gap-2 rounded-[12px] bg-accent-soft px-3 py-2 text-[12.5px]">
        <Gift className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <span>Provided free by the Cloudesk team{s.compUntil ? ` until ${day(s.compUntil)}` : ""}.</span>
      </div>
    );
  }

  const canCancel = !s.complimentary && !s.cancelAtPeriodEnd && (o.state === "trial" || o.state === "active");
  const canResume = !s.complimentary && s.cancelAtPeriodEnd && o.state !== "expired";
  const endsAt = o.state === "trial" ? s.trialEndsAt : s.currentPeriodEnd;

  return (
    <Card className="overflow-hidden">
      <div className="relative grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(60% 120% at 0% 0%, color-mix(in srgb, var(--tint-lavender) 55%, transparent), transparent 70%)" }} />
        <div className="relative grid content-start gap-4">
          <div>
            <p className="text-[12px] font-medium text-muted">{o.state === "trial" ? (trialPlan ? "On your free trial" : "Your plan after the trial") : "Current plan"}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-[26px] leading-tight font-semibold tracking-[-0.025em]">{o.state === "free" ? "Free plan" : trialPlan ? "Free trial" : s.planName}</h2>
              {!(trialPlan && o.state === "trial" && !s.cancelAtPeriodEnd) && o.state !== "free" && <Badge tone={badge.tone}>{badge.label}</Badge>}
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {o.state === "free"
                ? `${(o.free?.modules ?? []).map((m) => moduleById(m as ModuleId)?.name ?? m).join(", ")} — with monthly allowances. Choose a plan for every feature and no limits.`
                : trialPlan
                ? `Every feature for ${o.stats.trialDays} days. Choose a plan any time — nothing is charged until the trial ends.`
                : s.complimentary
                  ? `${intervalWord(s.interval)} plan · no charge`
                  : `${money(s.amount, cur)}${perWord(s.interval)} + ${o.pricing.taxLabel}${s.interval === "year" ? ` · ${money(s.monthly, cur)}/month` : ""}`}
            </p>
          </div>
          {bar}
          {s.pending && o.state !== "expired" && (
            <div className="flex items-start gap-2 rounded-[12px] border border-border bg-surface px-3 py-2 text-[12.5px]">
              <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-muted" />
              <span>
                Moves to <b className="font-semibold">{s.pending.planName}</b> ({intervalWord(s.pending.interval)}, {money(s.pending.amount, s.pending.currency ?? cur)}
                {perWord(s.pending.interval)}) on <b className="font-semibold">{shortDay(s.pending.effectiveAt ?? s.currentPeriodEnd)}</b>. You keep everything on {s.planName} until then. Choosing a bigger plan replaces this change.
              </span>
            </div>
          )}
          {o.state === "trial" && !trialPlan && !s.cancelAtPeriodEnd && !next && !(s.currentPeriodEnd && s.amount > 0) && (
            <div className="flex items-start gap-2 rounded-[12px] border border-border bg-surface px-3 py-2 text-[12.5px] text-muted">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>There&apos;s no open invoice for {s.planName} yet. Contact support to raise it, or choose a plan below, so the trial carries on without a break.</span>
            </div>
          )}
          {s.cancelAtPeriodEnd && o.state !== "expired" && (
            <div className="flex items-start gap-2 rounded-[12px] bg-warning-soft px-3 py-2 text-[12.5px]">
              <Undo2 className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>
                {o.state === "trial" ? "Your trial won't continue into a paid plan" : `${s.planName} won't renew`} — the workspace {o.free ? "moves to the Free plan" : "becomes read-only"} after <b className="font-semibold">{day(endsAt)}</b>. Resume any time before then to carry on.
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {(o.state === "expired" || (o.state === "trial" && trialPlan)) && (
              <Button variant="primary" icon={<Sparkles className="size-3.5" />} onClick={onChoose}>
                Choose a plan
              </Button>
            )}
            {canResume && (
              <Button variant="primary" loading={busy} onClick={onResume}>
                Resume {o.state === "trial" ? "my trial plan" : s.planName}
              </Button>
            )}
            {canCancel && (
              <Button variant="ghost" onClick={() => setConfirm(true)}>
                {o.state === "trial" ? "Don't continue after the trial" : "Cancel plan"}
              </Button>
            )}
          </div>
        </div>

        <div className="relative grid content-start gap-3 rounded-[16px] border border-border bg-surface p-4">
          {next ? (
            <>
              <div>
                <p className="text-[12px] font-medium text-muted">{next.dueAt && !isFuture(next.dueAt, -86_400_000) ? "Overdue" : "Next payment"}</p>
                <p className="mt-0.5 text-[24px] font-semibold tracking-[-0.02em] tabular-nums">{money(next.total, next.currency)}</p>
                <p className="text-[12.5px] text-muted">
                  Due {day(next.dueAt)} · {next.number}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" loading={paying === next.id} onClick={() => onPay(next)} icon={<Wallet className="size-3.5" />}>
                  Pay now
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onView(next)}>
                  View
                </Button>
              </div>
              {open.length > 1 && <p className="text-[11.5px] text-subtle">{open.length} open invoices · {money(o.stats.due, cur)} in all</p>}
            </>
          ) : o.state === "active" && s.currentPeriodEnd && !s.complimentary && s.amount > 0 ? (
            <div>
              <p className="text-[12px] font-medium text-muted">Next renewal</p>
              <p className="mt-0.5 text-[24px] font-semibold tracking-[-0.02em] tabular-nums">{money((s.pending?.amount ?? s.amount) + taxOf(s.pending?.amount ?? s.amount, o.pricing.taxBps), cur)}</p>
              <p className="text-[12.5px] text-muted">
                On {day(s.currentPeriodEnd)} · incl. {o.pricing.taxLabel}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-[12px] font-medium text-muted">Next payment</p>
              <p className="mt-0.5 text-[15px] font-semibold">Nothing due</p>
              <p className="text-[12.5px] text-muted">{o.state === "trial" ? (trialPlan ? "Choose a plan to see your first invoice." : "") : o.state === "canceling" ? "No renewal — the plan ends as you asked." : ""}</p>
            </div>
          )}
          {s.credit > 0 && (
            <div className="flex items-center justify-between border-t border-border pt-3 text-[12.5px]">
              <span className="text-muted">Account credit</span>
              <span className="font-medium text-success tabular-nums">{money(s.credit, cur)}</span>
            </div>
          )}
          {!o.providers.length && open.length > 0 && <p className="border-t border-border pt-3 text-[11.5px] text-muted">Online payments aren&apos;t set up yet — contact support to pay by bank transfer or UPI.</p>}
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          onCancel();
        }}
        destructive
        title={o.state === "trial" ? "Don't continue after the trial?" : `Cancel ${s.planName}?`}
        confirmLabel={o.state === "trial" ? "Don't continue" : "Cancel at period end"}
        description={
          o.state === "trial" ? (
            <>
              Your trial carries on with everything until <b>{day(s.trialEndsAt)}</b>. After that {o.free ? "this workspace moves to the Free plan — work in features Free doesn't include is kept but locked" : "this workspace becomes read-only — nothing is deleted, you can still sign in and export"}, and choosing a plan switches everything back on.{!trialPlan ? " The invoice for after the trial is cancelled." : ""} You can undo this until the trial ends.
            </>
          ) : (
            <>
              You keep {s.planName} until <b>{day(s.currentPeriodEnd)}</b> and won&apos;t be charged again. After that the workspace {o.free ? "moves to the Free plan" : "becomes read-only"} — nothing is deleted, and choosing a plan brings everything back. {s.pending ? "The scheduled plan change is dropped. " : ""}You can resume any time before then.
            </>
          )
        }
      />
    </Card>
  );
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function Tile({ icon, label, children, sub }: { icon: ReactNode; label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-h-[104px] flex-col justify-between rounded-[18px] border border-border bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
        <span className="text-subtle [&>svg]:size-3.5">{icon}</span>
        {label}
      </p>
      <div className="mt-2">{children}</div>
      {sub && <p className="mt-1 text-[11.5px] text-subtle">{sub}</p>}
    </div>
  );
}

function Meter({ used, limit }: { used: number; limit: Limit }) {
  const unlimited = isUnlimited(limit);
  const pct = unlimited ? 0 : Math.min(100, (used / Math.max(1, limit!)) * 100);
  const full = !unlimited && used >= limit!;
  return (
    <>
      <p className="text-[22px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
        {used}
        <span className="text-[14px] font-medium text-muted"> / {unlimited ? "∞" : limit}</span>
      </p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className={cx("h-full rounded-full transition-[width] duration-500", full ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-fg")} style={{ width: `${unlimited ? (used ? 4 : 0) : Math.max(pct, used ? 3 : 0)}%` }} />
      </div>
    </>
  );
}

export function Stats({ o }: { o: Overview }) {
  const cur = o.subscription?.currency ?? o.pricing.currency;
  const st = o.stats;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Tile icon={<Layers />} label="Features" sub={o.entitled === null ? "Everything is included" : "in your plan"}>
        <p className="text-[22px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
          {st.featuresIncluded}
          <span className="text-[14px] font-medium text-muted"> of {st.featuresTotal}</span>
        </p>
      </Tile>
      <Tile icon={<Users />} label="Team seats">
        <Meter used={o.usage.seats} limit={o.limits.seats} />
      </Tile>
      <Tile icon={<AppWindow />} label="Web apps">
        <Meter used={o.usage.projects} limit={o.limits.projects} />
      </Tile>
      <Tile icon={<Globe />} label="Custom domains">
        <Meter used={o.usage.customDomains} limit={o.limits.customDomains} />
      </Tile>
      <Tile icon={<Receipt />} label="Total paid" sub={st.paidInvoices ? plural(st.paidInvoices, "invoice") : "No payments yet"}>
        <p className="text-[22px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{money(st.paidTotal, cur)}</p>
      </Tile>
      <Tile icon={<CheckCircle2 />} label="Customer since" sub={st.customerSince ? timeAgo(st.customerSince) : "From your first payment"}>
        <p className="text-[18px] leading-none font-semibold tracking-[-0.02em]">{st.customerSince ? day(st.customerSince) : "—"}</p>
      </Tile>
    </div>
  );
}

// ─── Invoices ───────────────────────────────────────────────────────────────

export function Invoices({ o, onPay, paying, onView }: { o: Overview; onPay: (inv: Invoice) => void; paying: string | null; onView: (inv: Invoice) => void }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
        <FileText className="size-4" aria-hidden />
        <h2 className="text-[14px] font-semibold">Invoices</h2>
        {o.stats.due > 0 && <Badge tone="warning">{money(o.stats.due, o.pricing.currency)} due</Badge>}
        {o.stats.paidInvoices > 0 && (
          <span className="ml-auto text-right text-[12px] text-muted tabular-nums">
            {money(o.stats.paidTotal, o.subscription?.currency ?? o.pricing.currency)} paid{o.stats.customerSince ? ` since ${shortDay(o.stats.customerSince)}` : ""}
          </span>
        )}
      </div>
      {o.invoices.length === 0 ? (
        <EmptyState className="py-10" title="No invoices yet" description="Choose a plan and its invoice appears here — every one can be printed or saved as a PDF." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px] max-sm:min-w-0">
            <thead className="max-sm:hidden">
              <tr className="border-b border-border text-left text-[11.5px] font-medium text-muted">
                <th className="px-5 py-2 font-medium">Invoice</th>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {o.invoices.map((i) => (
                <tr key={i.id} className="max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-3 max-sm:gap-y-1 max-sm:px-4 max-sm:py-3">
                  <td className="px-5 py-2.5 max-sm:p-0">
                    <span className="font-mono text-[12.5px] font-medium">{i.number}</span>
                    <span className="block max-w-[240px] truncate text-[12px] text-muted max-sm:max-w-[200px]">{i.description}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted max-sm:hidden">{i.periodStart ? `${shortDay(i.periodStart)} – ${shortDay(i.periodEnd)}` : "—"}</td>
                  <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap tabular-nums max-sm:p-0">{money(i.total, i.currency)}</td>
                  <td className="px-3 py-2.5 max-sm:p-0">
                    <Badge tone={invoiceTone(i.status, i.dueAt)}>{invoiceStatus(i.status, i.dueAt)}</Badge>
                    {i.status === "paid" && i.paidAt && <span className="ml-1.5 text-[11.5px] text-subtle sm:hidden">{shortDay(i.paidAt)}</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted max-sm:p-0 max-sm:text-right max-sm:text-[12px]">{i.status === "open" ? <>Due {shortDay(i.dueAt)}</> : i.status === "paid" ? <span className="max-sm:hidden">Paid {shortDay(i.paidAt)}</span> : "—"}</td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap max-sm:col-span-2 max-sm:p-0 max-sm:pt-1 max-sm:text-left">
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => onView(i)}>
                        View
                      </Button>
                      {i.status === "open" && i.total > 0 && (
                        <Button size="sm" variant="primary" loading={paying === i.id} onClick={() => onPay(i)}>
                          Pay
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── History ────────────────────────────────────────────────────────────────

export function Timeline({ o }: { o: Overview }) {
  const [all, setAll] = useState(false);
  const rows = all ? o.events : o.events.slice(0, 8);
  return (
    <Card className="p-5">
      <h2 className="text-[14px] font-semibold">History</h2>
      {o.events.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">Nothing yet.</p>
      ) : (
        <ol className="mt-3 grid gap-0">
          {rows.map((e, idx) => (
            <li key={e.id} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-3 pb-3.5 last:pb-0">
              {idx < rows.length - 1 && <span aria-hidden className="absolute top-3 bottom-0 left-[8px] w-px bg-border" />}
              <span aria-hidden className={cx("relative mt-1 size-[9px] justify-self-center rounded-full ring-4 ring-surface", e.byPlatform ? "bg-accent" : ["paid", "activated", "renewed", "upgraded"].includes(e.kind) ? "bg-success" : ["past_due", "expired", "canceled"].includes(e.kind) ? "bg-danger" : "bg-subtle")} />
              <div className="min-w-0">
                <p className="text-[13px]">{eventText(e, o.invoices, o.pricing.currency, money)}</p>
                <p className="text-[11.5px] text-subtle" title={new Date(e.createdAt).toLocaleString("en-IN")}>
                  {day(e.createdAt)} · {timeAgo(e.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {o.events.length > 8 && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${o.events.length}`}
        </Button>
      )}
    </Card>
  );
}
