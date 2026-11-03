"use client";

// Real screens from the app, for onboarding: a browser window that cross-fades
// through screenshots of the chosen features (with the feature's name and a
// progress line), the welcome screen's showcase with a phone and floating
// notes beside it, and a strip of screens for phones. Rotation stops for
// reduced motion and while the tab is hidden.
import clsx from "clsx";
import { BellRing, TrendingUp } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { IPhone17 } from "@/components/marketing/iphone";
import { ModuleGlyph } from "@/components/shell/module-glyph";
import { moduleById, type ModuleId } from "@/lib/workspace/modules";

/** One screenshot per feature, from public/marketing (all 2880×1800). */
export const SHOTS: Record<ModuleId, string> = {
  store: "store/products", pos: "pos/till", horeca: "horeca/floor", crm: "crm/deals", hr: "hrms/payroll", inventory: "inventory/home", sales: "sales/orders",
  manufacturing: "manufacturing/work-orders", quality: "quality/inspections", maintenance: "maintenance/assets", documents: "documents/live", marketing: "marketing/campaigns",
  logistics: "logistics/shipments", bi: "reports/dashboard", copilot: "copilot/checks", helpdesk: "helpdesk/inbox", portal: "portals/customer", grc: "compliance/home",
  education: "education/students", clinic: "clinic/patients", construction: "construction/home", objects: "custom-objects/records", work: "projects/board",
  accounting: "accounting/pl", invoicing: "finance/overview", bookings: "bookings/upcoming", promotions: "promotions/list", growth: "growth/overview",
  automations: "automations/list", chatbot: "chatbot/inbox", data: "data/rows", "ai-ide": "ai-ide/editor", mail: "mail/inbox", calendar: "calendar/week", chat: "chat/channel",
};

export type Shot = { key: string; src: string; label: string; id?: ModuleId };
export const shotsFor = (ids: ModuleId[]): Shot[] => ids.map((id) => ({ key: id, id, src: `/marketing/${SHOTS[id]}.jpg`, label: moduleById(id)?.name ?? id }));

function useCalm() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      m.addEventListener("change", cb);
      document.addEventListener("visibilitychange", cb);
      return () => (m.removeEventListener("change", cb), document.removeEventListener("visibilitychange", cb));
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden,
    () => true,
  );
}

/** Cycles through `items` every `every` ms; returns the index showing. */
function useCycle(count: number, every: number) {
  const calm = useCalm();
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (calm || count < 2) return;
    const t = setTimeout(() => setAt((a) => (a + 1) % count), every);
    return () => clearTimeout(t);
  }, [at, calm, count, every]);
  return { at: count ? at % count : 0, calm, set: setAt };
}

/** A browser window cross-fading through real screens, captioned with the feature. */
export function ShotCycle({ items, every = 3400, url, className, compact }: { items: Shot[]; every?: number; url?: string; className?: string; compact?: boolean }) {
  const { at, calm, set } = useCycle(items.length, every);
  const cur = items[at];
  if (!cur) return null;
  return (
    <div className={clsx("overflow-hidden rounded-[22px] bg-[var(--surface-solid)] shadow-[0_40px_90px_-44px_rgb(40_20_80/0.55)] ring-1 ring-fg/[0.07]", className)}>
      <div className="flex h-8 items-center gap-1.5 border-b border-fg/[0.06] px-3.5">
        <i className="size-2.5 rounded-full bg-[#ff5f57]" />
        <i className="size-2.5 rounded-full bg-[#febc2e]" />
        <i className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="mx-auto truncate rounded-full bg-fg/[0.05] px-3 py-0.5 text-[10.5px] font-medium text-fg/45">{url ?? "app.cloudesk.in"}</span>
      </div>
      <div className={clsx("relative overflow-hidden bg-white", compact ? "aspect-[16/9]" : "aspect-[16/10]")}>
        {items.map((s, k) => (
          <div key={s.key} aria-hidden={k !== at} className={clsx("absolute inset-0 transition-opacity duration-[900ms] ease-out", k === at ? "opacity-100" : "opacity-0")}>
            <div className={clsx("absolute inset-0", k === at && !calm && "ob-shot-pan")} style={{ animationDuration: `${every + 900}ms` }}>
              <Image src={s.src} alt={k === at ? `${s.label} in Cloudesk` : ""} fill sizes="(min-width: 1024px) 40vw, 90vw" className="object-cover object-left-top" />
            </div>
          </div>
        ))}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/25 to-transparent" />
        <span key={cur.key} className={clsx("ob-shot-cap absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full bg-white/90 py-1 pr-3 pl-1 text-[12px] font-semibold shadow-[0_10px_24px_-12px_rgb(0_0_0/0.45)] backdrop-blur", cur.id && `tint-${moduleById(cur.id)?.tint}`)}>
          <span className="tint-chip grid size-6 place-items-center rounded-full">{cur.id ? <ModuleGlyph id={cur.id} className="size-3.5" /> : <TrendingUp className="size-3.5" />}</span>
          {cur.label}
        </span>
        {items.length > 1 && (
          <span className="absolute right-3 bottom-3.5 flex gap-1">
            {items.slice(0, 8).map((s, k) => (
              <button key={s.key} type="button" onClick={() => set(k)} aria-label={`Show ${s.label}`} className="grid h-4 place-items-center">
                <span className={clsx("block h-1 rounded-full bg-white transition-all duration-500", k === at ? "w-4 opacity-100" : "w-1 opacity-60")} />
              </button>
            ))}
          </span>
        )}
        {!calm && items.length > 1 && <span key={`p${at}`} aria-hidden className="ob-shot-progress absolute bottom-0 left-0 h-[2px] w-full bg-white/80" style={{ animationDuration: `${every}ms` }} />}
      </div>
    </div>
  );
}

const WELCOME: Shot[] = [
  { key: "home", src: "/marketing/home/dashboard.jpg", label: "Your dashboard" },
  { key: "store", id: "store", src: "/marketing/store/sf-home.jpg", label: "Your online store" },
  { key: "invoicing", id: "invoicing", src: "/marketing/finance/overview.jpg", label: "Invoices & finance" },
  { key: "pos", id: "pos", src: "/marketing/pos/till.jpg", label: "Point of sale" },
  { key: "hr", id: "hr", src: "/marketing/hrms/payroll.jpg", label: "HR & payroll" },
  { key: "chat", id: "chat", src: "/marketing/chat/channel.jpg", label: "Chat" },
  { key: "bi", id: "bi", src: "/marketing/reports/dashboard.jpg", label: "Reports & dashboards" },
];
const PHONES = ["workspace/m-mail", "phones/invoicing", "phones/point-of-sale", "workspace/m-calendar"];

/** The welcome screen's right side: real screens, a phone, and notes that come and go. */
export function WelcomeShowcase() {
  const phone = useCycle(PHONES.length, 3000);
  return (
    <div className="relative mx-auto w-full max-w-[640px] pt-6 pb-14 pl-2 max-sm:hidden lg:pr-10">
      <div className="ob-badge" style={{ animationDelay: "200ms" }}>
        <ShotCycle items={WELCOME} url="your-business.cloudesk.in" />
      </div>
      {/* A phone in front, showing the same business on the go. */}
      <div className="ob-piece absolute right-0 -bottom-2 w-[25%] max-w-[150px]" style={{ animationDelay: "500ms", ["--dur" as string]: "8s", ["--rot" as string]: "3deg" }} aria-hidden>
        <IPhone17>
          {PHONES.map((p, k) => (
            <Image key={p} src={`/marketing/${p}.jpg`} alt="" fill sizes="150px" className={clsx("object-cover object-top transition-opacity duration-300", k === phone.at ? "opacity-100" : "opacity-0")} />
          ))}
        </IPhone17>
      </div>
      <span className="ob-piece absolute top-0 -left-4 inline-flex items-center gap-2.5 rounded-[16px] bg-[var(--surface-solid)] py-2 pr-3.5 pl-2 text-[12.5px] shadow-[0_18px_40px_-20px_rgb(40_20_80/0.45)] ring-1 ring-fg/[0.06]" style={{ animationDelay: "800ms", ["--dur" as string]: "7s", ["--rot" as string]: "-3deg" }} aria-hidden>
        <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--p-peach)] text-[var(--p-peach-ink)]"><BellRing className="size-4" /></span>
        <span><b className="block font-semibold">₹4.15L overdue</b><span className="text-fg/55">Reminder ready to send</span></span>
      </span>
      <span className="ob-piece absolute bottom-6 -left-6 inline-flex items-center gap-2.5 rounded-[16px] bg-[var(--surface-solid)] py-2 pr-3.5 pl-2 text-[12.5px] shadow-[0_18px_40px_-20px_rgb(40_20_80/0.45)] ring-1 ring-fg/[0.06]" style={{ animationDelay: "1100ms", ["--dur" as string]: "9s", ["--rot" as string]: "2deg" }} aria-hidden>
        <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--p-mint)] text-[var(--p-mint-ink)]"><TrendingUp className="size-4" /></span>
        <span><b className="block font-semibold">Sales up 12%</b><span className="text-fg/55">On last month</span></span>
      </span>
    </div>
  );
}

/** Phones: a slow strip of real screens under the welcome heading. */
export function ShotStrip() {
  const list = [...WELCOME, ...WELCOME];
  return (
    <div className="ob-strip -mx-4 overflow-hidden [contain:inline-size] sm:hidden" aria-hidden>
      <div className="ob-strip-track flex w-max gap-2.5 px-4">
        {list.map((s, k) => (
          <span key={k} className="relative h-[92px] w-[148px] shrink-0 overflow-hidden rounded-[14px] bg-white shadow-[0_14px_28px_-18px_rgb(40_20_80/0.5)] ring-1 ring-fg/[0.06]">
            <Image src={s.src} alt="" fill sizes="148px" className="object-cover object-left-top" />
          </span>
        ))}
      </div>
    </div>
  );
}
