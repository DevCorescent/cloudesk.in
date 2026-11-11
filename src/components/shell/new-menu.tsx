"use client";

// The top bar's "New": everything you can start from anywhere — a web app or
// a template first, then invoices, contacts, tickets, notes and the rest,
// grouped by what they're for and limited to the features this member has.
// A dropdown pointing at its button on a computer; a sheet from the bottom on a phone.
import { BarChart3, Boxes, CalendarPlus, ChevronDown, ClipboardCheck, Clock, FileSignature, FileText, Handshake, KanbanSquare, LayoutTemplate, LifeBuoy, Mail, NotebookPen, Plus, Receipt, Search, Send, ShieldAlert, ShoppingCart, Stethoscope, UserPlus, UserRound, Users, Wallet, Wand2, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCompose } from "@/components/mail/compose-provider";
import { cx } from "@/components/ui/primitives";
import { Keys } from "@/components/ui/shortcut";
import { visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { useSession } from "./session-context";

type Item = { id: string; label: string; hint: string; icon: ReactNode; tone: string; module?: ModuleId; href?: string; mail?: true; words?: string };

const MONEY = "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
const PEOPLE = "bg-sky-500/12 text-sky-700 dark:text-sky-300";
const TALK = "bg-violet-500/12 text-violet-700 dark:text-violet-300";
const WORK = "bg-amber-500/14 text-amber-700 dark:text-amber-300";
const OPS = "bg-rose-500/12 text-rose-700 dark:text-rose-300";

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Money",
    items: [
      { id: "invoice", label: "Invoice", hint: "Bill a customer", icon: <Receipt />, tone: MONEY, module: "invoicing", href: "/finance", words: "bill gst" },
      { id: "expense", label: "Expense", hint: "Record a bill or spend", icon: <Wallet />, tone: MONEY, module: "accounting", href: "/accounts/bills?new=expense", words: "bill purchase cost" },
      { id: "sale", label: "Sales order", hint: "Take an order", icon: <ShoppingCart />, tone: MONEY, module: "sales", href: "/sales/orders/new", words: "so customer" },
      { id: "po", label: "Purchase order", hint: "Order from a supplier", icon: <Boxes />, tone: MONEY, module: "inventory", href: "/inventory/orders/new", words: "po buy stock" },
    ],
  },
  {
    title: "Customers",
    items: [
      { id: "contact", label: "Contact", hint: "A person or lead", icon: <UserPlus />, tone: PEOPLE, module: "crm", href: "/crm/contacts", words: "lead customer client" },
      { id: "deal", label: "Deal", hint: "Track a sale to close", icon: <Handshake />, tone: PEOPLE, module: "crm", href: "/crm/deals", words: "opportunity pipeline" },
      { id: "ticket", label: "Ticket", hint: "Log a customer issue", icon: <LifeBuoy />, tone: PEOPLE, module: "helpdesk", href: "/helpdesk/tickets/new", words: "support complaint" },
      { id: "requisition", label: "Document request", hint: "Ask a client for files", icon: <ClipboardCheck />, tone: PEOPLE, module: "requisitions", href: "/requisitions/lists/new", words: "requisition checklist collect" },
      { id: "campaign", label: "Campaign", hint: "Email your customers", icon: <Send />, tone: PEOPLE, module: "marketing", href: "/marketing/campaigns", words: "newsletter blast marketing" },
    ],
  },
  {
    title: "Write & meet",
    items: [
      { id: "email", label: "Email", hint: "From any of your mailboxes", icon: <Mail />, tone: TALK, module: "mail", mail: true, words: "mail compose send" },
      { id: "meeting", label: "Meeting", hint: "Put it in the calendar", icon: <CalendarPlus />, tone: TALK, module: "calendar", href: "/calendar", words: "event schedule invite" },
      { id: "note", label: "Note", hint: "Jot something down", icon: <NotebookPen />, tone: TALK, href: "/notes?new=1", words: "memo notes" },
      { id: "document", label: "Document", hint: "A blank page", icon: <FileText />, tone: TALK, module: "documents", href: "/documents/new", words: "doc write page" },
      { id: "ai-doc", label: "Document with AI", hint: "Any contract, letter or policy", icon: <Wand2 />, tone: TALK, module: "documents", href: "/documents/studio", words: "agreement contract nda offer letter policy notice legal ai draft" },
      { id: "proposal", label: "Proposal", hint: "Start from the template", icon: <FileSignature />, tone: TALK, module: "documents", href: "/documents/new?template=proposal", words: "quote pitch" },
    ],
  },
  {
    title: "Team & work",
    items: [
      { id: "project", label: "Project", hint: "Plan work for a client", icon: <KanbanSquare />, tone: WORK, module: "work", href: "/work/projects/new", words: "job engagement" },
      { id: "time", label: "Time entry", hint: "Log hours worked", icon: <Clock />, tone: WORK, module: "work", href: "/work/timesheet", words: "timesheet hours" },
      { id: "person", label: "Employee", hint: "Add someone to HR", icon: <UserRound />, tone: WORK, module: "hr", href: "/hr/people", words: "staff hire person" },
      { id: "invite", label: "Invite", hint: "Bring a teammate in", icon: <Users />, tone: WORK, href: "/team", words: "member team user" },
    ],
  },
  {
    title: "Operations",
    items: [
      { id: "report", label: "Report", hint: "Charts from your data", icon: <BarChart3 />, tone: OPS, module: "bi", href: "/reports/new", words: "dashboard chart bi" },
      { id: "breakdown", label: "Breakdown", hint: "Report a machine fault", icon: <Wrench />, tone: OPS, module: "maintenance", href: "/maintenance/orders/new", words: "repair work order asset" },
      { id: "incident", label: "Incident", hint: "Record a compliance issue", icon: <ShieldAlert />, tone: OPS, module: "grc", href: "/compliance/incidents/new", words: "risk compliance" },
      { id: "patient", label: "Patient", hint: "Register at the clinic", icon: <Stethoscope />, tone: OPS, module: "clinic", href: "/clinic/patients?new=1", words: "clinic doctor" },
    ],
  },
];

export function NewMenu() {
  const { org } = useSession();
  const { available: canMail, compose } = useCompose();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Where the dropdown sits on a computer: under the button, its arrow on the button's middle.
  const [at, setAt] = useState({ top: 64, right: 16, caret: 24 });
  const trigger = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const match = (i: Item) => words.every((w) => `${i.label} ${i.hint} ${i.words ?? ""}`.toLowerCase().includes(w));
    return GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => (!i.module || visibleTo(org, i.module)) && (!i.mail || canMail) && match(i)) })).filter((g) => g.items.length);
  }, [org, canMail, q]);
  const featured = !q.trim() || /web|app|site|template|build|store/i.test(q);

  const close = (refocus = true) => {
    setOpen(false);
    setQ("");
    // Back to whichever button is showing (the full one on a computer, the "+" on a phone).
    if (refocus) Array.from(trigger.current?.querySelectorAll<HTMLButtonElement>(":scope button") ?? []).find((b) => b.offsetParent)?.focus();
  };
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (open) return close();
    // It opens on the page itself (the bar's blur would otherwise trap it), lined up with the button.
    const r = e.currentTarget.getBoundingClientRect();
    const right = Math.max(12, window.innerWidth - r.right);
    setAt({ top: r.bottom + 12, right, caret: Math.max(18, window.innerWidth - right - (r.left + r.width / 2) - 6) });
    setOpen(true);
  };
  const run = (i: Item) => {
    close(false);
    if (i.mail) compose();
    else if (i.href) router.push(i.href);
  };

  useEffect(() => {
    if (!open) return;
    const onResize = () => close(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Straight into the filter on a computer; on a phone the keyboard waits until they tap it.
    if (window.matchMedia("(min-width: 1024px)").matches) search.current?.focus();
    else panel.current?.querySelector<HTMLElement>("[data-new-item]")?.focus({ preventScroll: true });
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const all = Array.from(panel.current?.querySelectorAll<HTMLElement>("[data-new-item]") ?? []);
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (at + 1) % all.length : at <= 0 ? all.length - 1 : at - 1;
      all[next]?.focus();
    } else if (e.key === "Enter" && document.activeElement === search.current) {
      e.preventDefault();
      all[0]?.click();
    }
  };

  return (
    <div ref={trigger} className="relative flex">
      <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} className="new-btn hidden h-9 items-center gap-1.5 rounded-full bg-accent pr-3 pl-3.5 text-[13px] font-semibold text-accent-fg shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.12)] transition-[transform,opacity] hover:opacity-90 active:scale-[0.97] lg:inline-flex">
        <Plus className="size-4" aria-hidden /> New
        <ChevronDown className={cx("size-3.5 opacity-70 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      <span className="flex lg:hidden">
        <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-label="New" title="New" className="bar-icon">
          <Plus aria-hidden />
        </button>
      </span>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] lg:bg-transparent lg:backdrop-blur-none" onClick={() => close()} aria-hidden />
          <div
            ref={panel}
            role="dialog"
            aria-label="Create something new"
            onKeyDown={onKey}
            style={{ "--t": `${at.top}px`, "--r": `${at.right}px` } as CSSProperties}
            className="new-menu fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-[26px] border border-border bg-[var(--surface-solid)] pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_rgb(0_0_0/0.18)] animate-in lg:inset-x-auto lg:top-[var(--t)] lg:right-[var(--r)] lg:bottom-auto lg:max-h-[min(calc(100dvh-var(--t)-16px),640px)] lg:w-[min(620px,calc(100vw-24px))] lg:rounded-[20px] lg:pb-0 lg:shadow-[0_24px_60px_-12px_rgb(0_0_0/0.28),0_2px_8px_rgb(0_0_0/0.06)]"
          >
            {/* The arrow, pointing at the button that opened it. */}
            <span className="absolute -top-[7px] hidden size-3 rotate-45 rounded-tl-[3px] border-t border-l border-border bg-[var(--surface-solid)] lg:block" style={{ right: at.caret }} aria-hidden />
            <span className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-fg/15 lg:hidden" aria-hidden />

            <div className="shrink-0 px-4 pt-3 pb-3 lg:px-5 lg:pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[15px] font-semibold tracking-[-0.01em]">Create something new</p>
                <span className="hidden text-[11.5px] text-subtle lg:inline">↑↓ to move · ↵ to open · esc</span>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
                <input
                  ref={search}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="What do you want to create?"
                  aria-label="Filter what to create"
                  style={{ outline: "none" }}
                  className="h-10 w-full rounded-[12px] border border-border bg-surface pr-3 pl-9 text-[13.5px] transition-[border-color,box-shadow,background] placeholder:text-subtle focus:border-fg/25 focus:bg-[var(--surface-solid)] focus:shadow-[0_0_0_4px_rgb(0_0_0/0.05)] focus-visible:outline-none"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 lg:px-4 lg:pb-4">
              {featured && (
                <div className="grid grid-cols-2 gap-2 px-1">
                  <Featured href="/create" onGo={() => close(false)} icon={<Wand2 />} title="Web app" sub="Describe it — AI builds it" primary />
                  <Featured href="/templates" onGo={() => close(false)} icon={<LayoutTemplate />} title="From a template" sub="Sites, stores and apps" />
                </div>
              )}
              {groups.length ? (
                <div className="mt-3 grid gap-x-3 gap-y-3 sm:grid-cols-2">
                  {groups.map((g) => (
                    <section key={g.title} aria-label={g.title}>
                      <p className="px-2 pb-1 text-[10.5px] font-semibold tracking-[0.12em] text-subtle uppercase">{g.title}</p>
                      <ul className="grid gap-0.5">
                        {g.items.map((i) => (
                          <li key={i.id}>
                            <button type="button" data-new-item onClick={() => run(i)} className="group flex w-full items-center gap-3 rounded-[12px] px-2 py-1.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-fg/15">
                              <span className={cx("grid size-8 shrink-0 place-items-center rounded-[10px] transition-transform group-hover:scale-105 [&>svg]:size-4", i.tone)}>{i.icon}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">{i.label}</span>
                                <span className="block truncate text-[11.5px] text-muted">{i.hint}</span>
                              </span>
                              <Plus className="size-3.5 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                !featured && <p className="px-2 py-6 text-center text-[13px] text-muted">Nothing called “{q.trim()}” to create. Try the search (<Keys k="mod+k" always />) for everything else.</p>
              )}
            </div>

            <div className="hidden shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-2.5 text-[11.5px] text-subtle lg:flex">
              <span>Only the features you have are shown.</span>
              <span className="flex items-center gap-1.5">Everything else <Keys k="mod+k" always /></span>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function Featured({ href, icon, title, sub, primary, onGo }: { href: string; icon: ReactNode; title: string; sub: string; primary?: boolean; onGo: () => void }) {
  return (
    <Link
      href={href}
      data-new-item
      onClick={onGo}
      className={cx(
        "group relative flex min-w-0 items-center gap-3 overflow-hidden rounded-[16px] border p-3 outline-none transition-[transform,box-shadow,background] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-fg/20",
        primary ? "border-transparent bg-accent text-accent-fg shadow-[0_8px_24px_-10px_rgb(0_0_0/0.45)] hover:shadow-[0_12px_28px_-10px_rgb(0_0_0/0.5)]" : "border-border bg-surface hover:bg-surface-2",
      )}
    >
      {primary && <span className="pointer-events-none absolute -top-8 -right-6 size-24 rounded-full bg-[radial-gradient(circle,rgb(167_139_250/0.55),transparent_70%)]" aria-hidden />}
      <span className={cx("relative grid size-9 shrink-0 place-items-center rounded-[11px] [&>svg]:size-[18px]", primary ? "bg-white/15" : "bg-violet-500/12 text-violet-700 dark:text-violet-300")}>{icon}</span>
      <span className="relative min-w-0">
        <span className="block truncate text-[13.5px] font-semibold">{title}</span>
        <span className={cx("line-clamp-2 block text-[11.5px] leading-snug", primary ? "opacity-75" : "text-muted")}>{sub}</span>
      </span>
    </Link>
  );
}
