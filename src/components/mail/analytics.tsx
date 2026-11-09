"use client";

// Mail analytics: mail in and out, how fast it's answered (median, spread and
// against each mailbox's reply target), when mail arrives, who sends it, what's
// owed right now, and per mailbox and per teammate. Every number comes from
// the stored mail for the chosen period; the previous period is shown beside it.
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ArrowDown, ArrowLeft, ArrowUp, Clock, Gauge, Inbox, Mail, MessageSquareReply, Send, Target } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChartView, type Result } from "@/components/bi/chart";
import { EmptyState, ErrorState, Select, Skeleton, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { MailStats, MetaOut } from "@/lib/mail/api";
import { CATEGORY_LABEL } from "@/lib/mail/model";
import { Avatar, mailKey, useMailApi } from "./shared";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** 42 min · 3h 12m · 2.4 days */
export function fmtMinutes(m: number | null) {
  if (m === null) return "—";
  if (m < 1) return "under a minute";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const r = Math.round(m % 60);
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  return `${(m / 1440).toFixed(1)} days`;
}
const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`);
const num = (v: number) => v.toLocaleString("en-IN");

export function MailAnalytics({ meta }: { meta: MetaOut }) {
  const { orgId, call } = useMailApi();
  const [days, setDays] = useState(30);
  const [account, setAccount] = useState("all");
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const q = useQuery({ queryKey: mailKey(orgId, "analytics", days, account, tz), queryFn: () => call<MailStats>(`analytics?days=${days}&account=${account}&tz=${encodeURIComponent(tz)}`) });
  const a = q.data;
  const noTarget = meta.accounts.every((x) => !x.settings.slaHours);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-8">
      <Link href="/mail" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Back to mail</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Mail analytics</h1>
          <p className="mt-0.5 text-[13px] text-muted">{a ? `${new Date(`${a.range.from}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })} – ${new Date(`${a.range.to}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · compared with the ${days} days before` : "How much mail comes and goes, and how fast it's answered."}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {meta.accounts.length > 1 && (
            <Select aria-label="Mailbox" value={account} onChange={(e) => setAccount(e.target.value)} className="!h-9 max-sm:!w-full sm:!w-auto">
              <option value="all">All mailboxes</option>
              {meta.accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          )}
          <div role="radiogroup" aria-label="Period" className="grid w-full grid-cols-3 rounded-full bg-surface-2 p-1 sm:inline-flex sm:w-auto">
            {[7, 30, 90].map((d) => (
              <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={cx("h-8 rounded-full px-3.5 text-[12.5px] font-medium transition-colors sm:h-7", days === d ? "bg-[var(--surface-solid)] text-fg shadow-sm" : "text-muted hover:text-fg")}>{d} days</button>
            ))}
          </div>
        </div>
      </div>

      {q.isError ? (
        <div className="mt-8"><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>
      ) : !a ? (
        <div className="mt-6 grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[108px] rounded-[18px]" />)}</div>
          <Skeleton className="h-[320px] rounded-[20px]" />
        </div>
      ) : a.totals.received + a.totals.sent === 0 ? (
        <div className="mt-10"><EmptyState icon={<Mail className="size-6" />} title="No mail in this period" description="Once mail comes and goes, the numbers fill in. Try a longer period." /></div>
      ) : (
        <div className="mt-6 grid gap-4">
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi icon={<Inbox />} hue="sky" label="Received" value={num(a.totals.received)} now={a.totals.received} before={a.prev.received} />
            <Kpi icon={<Send />} hue="violet" label="Sent" value={num(a.totals.sent)} now={a.totals.sent} before={a.prev.sent} hint={a.totals.autoReplies ? `+ ${a.totals.autoReplies} auto-replies` : undefined} />
            <Kpi icon={<Clock />} hue="amber" label="Typical reply time" value={fmtMinutes(a.totals.medianReplyMin)} now={a.totals.medianReplyMin} before={a.prev.medianReplyMin} lowerIsBetter hint="Median, personal mail" />
            <Kpi icon={<MessageSquareReply />} hue="emerald" label="Reply rate" value={pct(a.totals.replyRate)} now={a.totals.replyRate} before={a.prev.replyRate} points hint={`${num(a.totals.replied)} of ${num(a.totals.owed)} answered`} />
            <Kpi icon={<Target />} hue="indigo" label="Within target" value={noTarget ? "No target" : pct(a.totals.withinSla)} hint={noTarget ? undefined : "Answered inside each mailbox's target"} action={noTarget ? <Link href="/mail/settings" className="text-[12px] font-medium text-sky-700 hover:underline dark:text-sky-400">Set a reply target</Link> : undefined} />
            <Kpi icon={<AlarmClock />} hue="rose" label="Needs reply now" value={num(a.totals.needsReply)} tone={a.totals.overdue ? "danger" : undefined} hint={a.totals.overdue ? `${num(a.totals.overdue)} past the target` : "None overdue"} />
          </div>

          <Card title="Mail in and out" sub="Received and sent each day (auto-replies left out)">
            <ChartView kind="line" r={dailyResult(a)} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="How fast you reply" sub={a.totals.p90ReplyMin !== null ? `Nine in ten replies within ${fmtMinutes(a.totals.p90ReplyMin)}` : "Replies to personal mail, by time taken"}>
              {a.replyBuckets.some((b) => b.n) ? <ChartView kind="bar" r={simple("Time to reply", "Replies", a.replyBuckets.map((b) => [b.label, b.n]))} /> : <Quiet>No replies in this period yet.</Quiet>}
            </Card>
            <Card title="When mail arrives" sub={`Received mail by day and hour (${a.range.tz.replace(/_/g, " ")})`}>
              <Heatmap hours={a.hours} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Needs a reply — oldest first" sub="Personal mail where they wrote last" className="lg:col-span-1">
              {a.oldestWaiting.length ? (
                <ul className="-mx-1 grid gap-0.5">
                  {a.oldestWaiting.map((w) => (
                    <li key={w.id}>
                      <Link href={`/mail/t/${w.id}`} className="flex items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-surface-2">
                        <Avatar p={{ name: w.from, address: w.from }} size={30} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{w.subject || "(no subject)"}</span>
                          <span className="block truncate text-[12px] text-muted">{w.from}</span>
                        </span>
                        <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium tabular-nums", w.overdue ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted")}>{fmtMinutes(w.waitingMin)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <Quiet>Nobody is waiting on you. 🎉</Quiet>}
            </Card>
            <Card title="Top senders" sub="Who sent the most">
              <Ranked rows={a.senders.map((x) => ({ key: x.address, label: x.name || x.address, sub: x.name ? x.address : undefined, n: x.n }))} />
              <Link href="/mail/cleanup" className="mt-3 inline-flex text-[12.5px] font-medium text-sky-700 hover:underline dark:text-sky-400">Clean up senders →</Link>
            </Card>
            <Card title="By category" sub="Where received mail was sorted">
              <Ranked rows={a.categories.map((x) => ({ key: x.category, label: CATEGORY_LABEL[x.category] ?? x.category, n: x.n }))} />
              {a.domains.length > 0 && (
                <>
                  <p className="mt-4 mb-1.5 text-[11.5px] font-semibold tracking-[0.08em] text-subtle uppercase">Top domains</p>
                  <Ranked rows={a.domains.slice(0, 5).map((x) => ({ key: x.domain, label: x.domain, n: x.n }))} />
                </>
              )}
            </Card>
          </div>

          <div className={cx("grid gap-4", a.people.length > 0 && "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]")}>
            <Card title="By mailbox" sub="Mail, reply times and what's owed">
              <ul className="grid gap-2 sm:hidden">
                {a.mailboxes.map((m) => (
                  <li key={m.id} className="rounded-[14px] border border-border p-3">
                    <p className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium"><span className="size-2.5 shrink-0 rounded-full" style={{ background: m.color }} /><span className="truncate">{m.name}</span>{m.overdue > 0 && <span className="ml-auto shrink-0 rounded-full bg-danger-soft px-1.5 text-[11px] font-medium text-danger">{m.overdue} late</span>}</p>
                    <dl className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2.5 text-[12px] tabular-nums">
                      <Stat k="Received" v={num(m.received)} />
                      <Stat k="Sent" v={num(m.sent)} />
                      <Stat k="Owed now" v={num(m.needsReply)} />
                      <Stat k="Typical reply" v={fmtMinutes(m.medianReplyMin)} />
                      <Stat k="Within target" v={m.slaHours ? `${pct(m.withinSla)} · ${m.slaHours}h` : "No target"} wide />
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="-mx-4 hidden overflow-x-auto px-4 sm:block">
                <table className="w-full min-w-[520px] text-[13px]">
                  <thead>
                    <tr className="text-left text-[11.5px] text-muted">
                      <th className="py-2 pr-3 font-medium">Mailbox</th>
                      <th className="py-2 pr-3 text-right font-medium">Received</th>
                      <th className="py-2 pr-3 text-right font-medium">Sent</th>
                      <th className="py-2 pr-3 text-right font-medium">Typical reply</th>
                      <th className="py-2 pr-3 text-right font-medium">Within target</th>
                      <th className="py-2 text-right font-medium">Owed now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.mailboxes.map((m) => (
                      <tr key={m.id} className="border-t border-border tabular-nums">
                        <td className="py-2.5 pr-3"><span className="flex items-center gap-2 font-medium"><span className="size-2.5 shrink-0 rounded-full" style={{ background: m.color }} /><span className="truncate">{m.name}</span></span></td>
                        <td className="py-2.5 pr-3 text-right">{num(m.received)}</td>
                        <td className="py-2.5 pr-3 text-right">{num(m.sent)}</td>
                        <td className="py-2.5 pr-3 text-right">{fmtMinutes(m.medianReplyMin)}</td>
                        <td className="py-2.5 pr-3 text-right">{m.slaHours ? <>{pct(m.withinSla)} <span className="text-muted">· {m.slaHours}h</span></> : <span className="text-muted">No target</span>}</td>
                        <td className="py-2.5 text-right">{num(m.needsReply)}{m.overdue > 0 && <span className="ml-1.5 rounded-full bg-danger-soft px-1.5 text-[11px] font-medium text-danger">{m.overdue} late</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {a.people.length > 0 && (
              <Card title="Who replied" sub="Replies to personal mail, by person">
                <ul className="grid gap-2">
                  {a.people.map((p) => (
                    <li key={p.id ?? "outside"} className="flex min-w-0 items-center gap-3 text-[13px]">
                      <Avatar p={{ name: p.name, address: p.name }} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate text-[12px] text-muted">{num(p.replies)} {p.replies === 1 ? "reply" : "replies"}{!p.id && " · from another app"}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13px] font-semibold tabular-nums">{fmtMinutes(p.medianReplyMin)}</span>
                        <span className="block text-[11px] text-subtle">typical</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
          <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-muted"><Gauge className="mt-0.5 size-3.5 shrink-0" /> Reply times count from their first unanswered email to your first real reply; auto-replies don&apos;t count. Reply rate and targets look at personal mail (Primary, People and New senders).</p>
        </div>
      )}
    </div>
  );
}

function Card({ title, sub, children, className }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("min-w-0 rounded-[20px] border border-border bg-surface p-4 sm:p-5", className)}>
      <h2 className="text-[14.5px] font-semibold tracking-[-0.01em]">{title}</h2>
      {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const Stat = ({ k, v, wide }: { k: string; v: string; wide?: boolean }) => (
  <div className={cx("min-w-0", wide && "col-span-2")}>
    <dt className="text-[11px] text-muted">{k}</dt>
    <dd className="truncate font-medium">{v}</dd>
  </div>
);

const Quiet = ({ children }: { children: ReactNode }) => <p className="py-8 text-center text-[13px] text-muted">{children}</p>;

/** A headline number with its change from the period before; arrows say which way, words say whether that's good. */
const HUE = {
  sky: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  amber: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  emerald: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  indigo: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300",
  rose: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
} as const;

function Kpi({ icon, hue, label, value, now, before, lowerIsBetter, points, hint, action, tone }: { icon: ReactNode; hue: keyof typeof HUE; label: string; value: string; now?: number | null; before?: number | null; lowerIsBetter?: boolean; points?: boolean; hint?: string; action?: ReactNode; tone?: "danger" }) {
  let change: { text: string; good: boolean; up: boolean } | null = null;
  if (now !== undefined && now !== null && before !== undefined && before !== null && (before > 0 || points)) {
    const diff = points ? now - before : ((now - before) / before) * 100;
    if (Math.abs(diff) >= 0.5) change = { text: points ? `${Math.abs(diff).toFixed(1)} pts` : `${Math.abs(Math.round(diff))}%`, up: diff > 0, good: lowerIsBetter ? diff < 0 : diff > 0 };
  }
  return (
    <div className="flex min-w-0 flex-col rounded-[18px] border border-border bg-surface p-3.5 sm:p-4">
      <p className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-muted">
        <span className={cx("grid size-7 shrink-0 place-items-center rounded-[9px] [&>svg]:size-3.5", HUE[hue])}>{icon}</span>
        <span className="truncate">{label}</span>
      </p>
      <p className={cx("mt-3 truncate text-[22px] leading-none font-semibold tracking-[-0.02em] tabular-nums sm:text-[24px]", tone === "danger" && "text-danger")}>{value}</p>
      <div className="mt-2 min-h-[18px] text-[11.5px] leading-snug text-muted">
        {change ? (
          <span className={cx("inline-flex items-center gap-0.5 font-medium", change.good ? "text-success" : "text-danger")}>
            {change.up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{change.text}
            <span className="font-normal text-muted"> vs before</span>
          </span>
        ) : action ?? hint}
        {change && hint && <span className="block truncate">{hint}</span>}
      </div>
    </div>
  );
}

function dailyResult(a: MailStats): Result {
  return {
    dims: 1,
    columns: [{ key: "day", label: "Day", type: "date", bucket: "day" }, { key: "received", label: "Received", type: "count" }, { key: "sent", label: "Sent", type: "count" }],
    rows: a.daily.map((d) => [d.day, d.received, d.sent]),
    totals: [null, a.totals.received, a.totals.sent],
    range: { from: a.range.from, to: a.range.to },
    truncated: false,
  };
}
function simple(dim: string, measure: string, rows: [string, number][]): Result {
  return { dims: 1, columns: [{ key: "k", label: dim, type: "text" }, { key: "n", label: measure, type: "count" }], rows, totals: [null, rows.reduce((s, r) => s + r[1], 0)], range: { from: null, to: null }, truncated: false };
}

/** Ranked list with a magnitude bar in one hue. */
function Ranked({ rows }: { rows: { key: string; label: string; sub?: string; n: number }[] }) {
  if (!rows.length) return <Quiet>Nothing yet.</Quiet>;
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-medium" title={r.sub ?? r.label}>{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{num(r.n)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.max(3, (r.n / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

/** Weekday × hour grid in one hue, light to dark; hover (or focus) a cell for its count. */
function Heatmap({ hours }: { hours: number[][] }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(...hours.flat(), 0);
  if (!max) return <Quiet>No mail received in this period.</Quiet>;
  const level = (v: number) => (v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const fill = ["var(--surface-2)", "color-mix(in srgb, var(--viz-1) 22%, transparent)", "color-mix(in srgb, var(--viz-1) 45%, transparent)", "color-mix(in srgb, var(--viz-1) 70%, transparent)", "var(--viz-1)"];
  const busiest = hours.flatMap((row, d) => row.map((v, h) => ({ d, h, v }))).sort((x, y) => y.v - x.v)[0]!;
  const range = (h: number) => `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;
  return (
    <div>
      <div>
        <div className="grid grid-cols-[28px_repeat(24,minmax(0,1fr))] gap-[2px] sm:grid-cols-[34px_repeat(24,minmax(0,1fr))] sm:gap-[3px]" onMouseLeave={() => setHover(null)}>
          {hours.map((row, d) => (
            <div key={d} className="contents">
              <span className="pr-1 text-right text-[11px] leading-[16px] text-muted">{WEEKDAYS[d]}</span>
              {row.map((v, h) => (
                <span
                  key={h}
                  tabIndex={0}
                  role="img"
                  aria-label={`${WEEKDAYS[d]} ${range(h)}: ${v} emails`}
                  onMouseEnter={() => setHover({ d, h })}
                  onFocus={() => setHover({ d, h })}
                  className={cx("h-3.5 rounded-[2px] outline-none sm:h-4 sm:rounded-[3px]", hover?.d === d && hover.h === h && "ring-2 ring-fg/60")}
                  style={{ background: fill[level(v)] }}
                />
              ))}
            </div>
          ))}
          <span />
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center text-[10px] text-subtle">{h % 6 === 0 ? h : ""}</span>)}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
        <span>{hover ? <><b className="font-semibold text-fg">{WEEKDAYS[hover.d]} {range(hover.h)}</b> · {hours[hover.d]![hover.h]} emails</> : <>Busiest: <b className="font-semibold text-fg">{WEEKDAYS[busiest.d]} {range(busiest.h)}</b> · {busiest.v} emails</>}</span>
        <span className="flex items-center gap-1">Fewer {fill.map((f, i) => <span key={i} className="size-3 rounded-[3px]" style={{ background: f }} />)} More</span>
      </div>
    </div>
  );
}
