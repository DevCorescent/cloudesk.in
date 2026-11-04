"use client";

// CRM: one place for every customer and lead in the workspace. The shell holds
// the navigation, global search and "New" menu; each section is its own view.
import { SectionSwitcher } from "@/components/shell/module-frame";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Briefcase, Building2, CheckSquare, Contact as ContactIcon, Home, Plus, Repeat, Search, Settings, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { Menu } from "@/components/ui/overlays";
import { Button, EmptyState, ErrorState, Skeleton, cx } from "@/components/ui/primitives";
import { Keys } from "@/components/ui/shortcut";
import { api, errorMessage } from "@/lib/client/api";
import { CompaniesView, CompanyPage } from "./companies";
import { ContactPage } from "./contact-page";
import { ContactsView } from "./contacts";
import { DealPage, DealsView } from "./deals";
import { CompanyDialog, ContactDialog, DealDialog, TaskDialog } from "./dialogs";
import { HomeView } from "./home";
import { ReportsView } from "./reports";
import { SequencePage, SequencesView } from "./sequences";
import { SettingsView } from "./settings";
import { Avatar, CrmProvider, LifecycleBadge, crmApi, useCrm, useCrmParts, useShortMoney, type Meta } from "./shared";
import { TasksView } from "./tasks";

const NAV: { id: string; label: string; icon: ReactNode; group?: string; part?: string }[] = [
  { id: "", label: "Home", icon: <Home /> },
  { id: "contacts", label: "Contacts", icon: <Users />, group: "Records" },
  { id: "companies", label: "Companies", icon: <Building2 /> },
  { id: "deals", label: "Deals", icon: <Briefcase />, part: "deals" },
  { id: "tasks", label: "Tasks", icon: <CheckSquare />, group: "Work" },
  { id: "sequences", label: "Sequences", icon: <Repeat />, part: "sequences" },
  { id: "reports", label: "Reports", icon: <BarChart3 /> },
  { id: "settings", label: "Settings", icon: <Settings />, group: "Setup" },
];

export function CrmApp({ path }: { path: string[] }) {
  const { org } = useSession();
  const router = useRouter();
  const meta = useQuery({ queryKey: ["crm", org.id, "meta"], queryFn: () => api<Meta>(crmApi(org.id, "meta")), retry: false });
  const [section = "", id] = path;
  const [creating, setCreating] = useState<"contact" | "company" | "deal" | "task" | null>(null);
  const part = useCrmParts();

  if (meta.isError) {
    const status = (meta.error as { status?: number }).status;
    return status === 403 ? (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <ContactIcon className="mx-auto size-6 text-muted" />
        <h1 className="mt-3 text-lg font-semibold">The CRM isn&apos;t on for this workspace</h1>
        <p className="mt-1 text-[13px] text-muted">{errorMessage(meta.error)}</p>
        <Link href="/settings/features" className="mt-4 inline-flex text-[13px] font-medium underline">
          Open Features
        </Link>
      </div>
    ) : (
      <ErrorState message={errorMessage(meta.error)} onRetry={() => meta.refetch()} />
    );
  }
  if (!meta.data)
    return (
      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 sm:px-8 lg:grid-cols-[200px_1fr]">
        <Skeleton className="hidden h-80 rounded-[20px] lg:block" />
        <Skeleton className="h-[70vh] rounded-[24px]" />
      </div>
    );

  const base = "/crm";
  const go = (p: string) => router.push(p ? `${base}/${p}` : base);
  const ctx = { orgId: org.id, meta: meta.data, base, go };
  const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/.test(x);
  let body: ReactNode;
  switch (section) {
    case "contacts":
      body = isId(id) ? <ContactPage key={id} id={id!} /> : <ContactsView />;
      break;
    case "companies":
      body = isId(id) ? <CompanyPage key={id} id={id!} /> : <CompaniesView />;
      break;
    case "deals":
      body = isId(id) ? <DealPage key={id} id={id!} /> : <DealsView />;
      break;
    case "tasks":
      body = <TasksView />;
      break;
    case "sequences":
      body = isId(id) ? <SequencePage key={id} id={id!} /> : <SequencesView />;
      break;
    case "reports":
      body = <ReportsView />;
      break;
    case "settings":
      body = <SettingsView tab={id} />;
      break;
    default:
      body = <HomeView onNew={setCreating} />;
  }
  const offPart = NAV.find((n) => n.id === section)?.part;
  if (offPart && !part(offPart)) body = <EmptyState icon={<Settings />} title="Switched off" description="This part of the CRM is switched off for your workspace. An owner or admin can switch it on in Settings → Features." />;
  const canWrite = meta.data.me.write;
  // The deal board needs every pixel: the menu becomes a row of tabs above it.
  const wide = section === "deals" && !isId(id);
  return (
    <CrmProvider value={ctx}>
      <div className={cx("mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-8 lg:py-8", wide ? "max-w-none lg:gap-4" : "lg:grid-cols-[200px_minmax(0,1fr)]")}>
        <SectionSwitcher title="CRM" items={NAV.filter((n) => !n.part || part(n.part))} section={section} href={(id) => (id ? `${base}/${id}` : base)} />
        <aside className={cx("hidden lg:block", !wide && "lg:sticky lg:top-6 lg:self-start")}>
          <div className={cx("mb-3 hidden px-2", !wide && "lg:block")}>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">Cloudesk CRM</p>
            <p className="mt-1 truncate text-[14px] font-semibold">{org.name}</p>
          </div>
          <nav aria-label="CRM" className={cx("-mx-1 flex gap-1 overflow-x-auto px-1 pb-1", !wide && "lg:flex-col lg:overflow-visible")}>
            {NAV.filter((n) => !n.part || part(n.part)).map((n) => {
              const on = section === n.id;
              return (
                <div key={n.id} className="contents">
                  {n.group && !wide && <p className="hidden px-3 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase lg:block">{n.group}</p>}
                  <Link href={n.id ? `${base}/${n.id}` : base} aria-current={on ? "page" : undefined} className={cx("flex shrink-0 items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4", on ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                    {n.icon}
                    {n.label}
                  </Link>
                </div>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0">
          <div className="mb-5 flex items-center gap-2">
            <GlobalSearch />
            {canWrite && (
              <Menu
                label="Create"
                trigger={(p) => (
                  <Button {...p} variant="primary" size="sm" icon={<Plus className="size-4" />}>
                    New
                  </Button>
                )}
                items={[
                  { label: "Contact", icon: <Users className="size-4" />, onSelect: () => setCreating("contact") },
                  { label: "Company", icon: <Building2 className="size-4" />, onSelect: () => setCreating("company") },
                  ...(part("deals") ? [{ label: "Deal", icon: <Briefcase className="size-4" />, onSelect: () => setCreating("deal") }] : []),
                  { label: "Task", icon: <CheckSquare className="size-4" />, onSelect: () => setCreating("task") },
                ]}
              />
            )}
          </div>
          {body}
        </main>
      </div>
      {creating === "contact" && <ContactDialog onClose={() => setCreating(null)} onSaved={(c) => go(`contacts/${c.id}`)} />}
      {creating === "company" && <CompanyDialog onClose={() => setCreating(null)} onSaved={(c) => go(`companies/${c.id}`)} />}
      {creating === "deal" && <DealDialog onClose={() => setCreating(null)} onSaved={(d) => go(`deals/${d.id}`)} />}
      {creating === "task" && <TaskDialog onClose={() => setCreating(null)} />}
    </CrmProvider>
  );
}

type Hits = { contacts: { id: string; name: string; email: string; phone: string; lifecycle: string }[]; companies: { id: string; name: string; domain: string }[]; deals: { id: string; title: string; value: number; status: string }[] };

/** Search everything; "/" jumps here from anywhere in the CRM. */
function GlobalSearch() {
  const { orgId, go } = useCrm();
  const short = useShortMoney();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const hits = useQuery({ queryKey: ["crm", orgId, "search", q], queryFn: () => api<Hits>(crmApi(orgId, `search?q=${encodeURIComponent(q)}`)), enabled: q.trim().length >= 2 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const items = [
    ...(hits.data?.contacts ?? []).map((c) => ({ key: c.id, href: `contacts/${c.id}`, title: c.name || c.email || c.phone, sub: c.email || c.phone, icon: <Avatar name={c.name || c.email} size={26} />, right: <LifecycleBadge value={c.lifecycle} /> })),
    ...(hits.data?.companies ?? []).map((c) => ({ key: c.id, href: `companies/${c.id}`, title: c.name, sub: c.domain, icon: <Avatar name={c.name} size={26} square />, right: <span className="text-[11px] text-subtle">Company</span> })),
    ...(hits.data?.deals ?? []).map((d) => ({ key: d.id, href: `deals/${d.id}`, title: d.title, sub: d.status === "open" ? "Open deal" : d.status === "won" ? "Won" : "Lost", icon: <span className="grid size-[26px] place-items-center rounded-[8px] bg-surface-2"><Briefcase className="size-3.5 text-muted" /></span>, right: <b className="text-[12px] tabular-nums">{short(d.value)}</b> })),
  ];
  const pick = (href: string) => {
    setOpen(false);
    setQ("");
    (document.activeElement as HTMLElement | null)?.blur();
    go(href);
  };
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        ref={ref}
        value={q}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls="crm-search-results"
        aria-label="Search contacts, companies and deals"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && items[active]) pick(items[active].href);
          else if (e.key === "Escape") {
            setQ("");
            e.currentTarget.blur();
          }
        }}
        placeholder="Search people, companies, deals…"
        className="h-9 w-full rounded-full border border-border bg-surface pr-10 pl-9 text-[13.5px] outline-none focus:border-fg/40"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 sm:block">
        <Keys k="/" />
      </span>
      {open && q.trim().length >= 2 && (
        <ul id="crm-search-results" role="listbox" className="absolute inset-x-0 top-11 z-40 max-h-[60vh] overflow-y-auto rounded-[18px] border border-border bg-surface-solid p-1.5 shadow-xl">
          {!items.length ? (
            <li className="px-3 py-4 text-center text-[13px] text-muted">{hits.isFetching ? "Searching…" : "Nothing matches"}</li>
          ) : (
            items.map((it, i) => (
              <li key={it.key} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it.href)} onMouseEnter={() => setActive(i)} className={cx("flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left", i === active && "bg-surface-2")}>
                  {it.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{it.title}</span>
                    {it.sub && <span className="block truncate text-[12px] text-muted">{it.sub}</span>}
                  </span>
                  {it.right}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
