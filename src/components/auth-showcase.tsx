"use client";

// The right-hand panel on sign-in screens: soft pastel light and a short tour of
// what Cloudesk does — a site and store, GST billing, mail that files itself
// into Notes, Calendar and Chat, and chat you can invite anyone into. Each scene
// plays a few seconds of animation; the tab's fill is the timer, it pauses while
// the pointer is over the panel, and with reduced motion it stays put.
// Below lg the same story is a quiet strip of features under the form.
import clsx from "clsx";
import {
  CalendarDays, Check, Download, Fingerprint, Globe, Hash, KeyRound, LayoutGrid, Mail, MessagesSquare, NotebookPen,
  ReceiptText, Repeat, ShieldCheck, ShoppingBag, Sparkles, Store, UserPlus, Users, type LucideIcon,
} from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import "./auth-showcase.css";

const SCENE_MS = 6500;
const d = (s: number) => ({ ["--d" as string]: `${s}s` }) as CSSProperties;

type Scene = { id: string; label: string; icon: LucideIcon; tone: string; title: string; line: string; render: () => ReactNode };

const SCENES: Scene[] = [
  { id: "build", label: "Build", icon: Globe, tone: "lavender", title: "Your website and store, live today", line: "Describe your business — AI drafts the pages, you publish and start selling.", render: () => <BuildScene /> },
  { id: "bill", label: "Bill", icon: ReceiptText, tone: "peach", title: "GST invoices that add up themselves", line: "CGST, SGST or IGST worked out, payments recorded, books kept for you.", render: () => <BillScene /> },
  { id: "mail", label: "Mail", icon: Mail, tone: "sky", title: "Mail that connects to everything", line: "Save an email to Notes, put its meeting on your calendar, share it in chat.", render: () => <MailScene /> },
  { id: "chat", label: "Chat", icon: MessagesSquare, tone: "mint", title: "Chat with your team — and anyone else", line: "Invite a client by link; they join with just their name once you approve.", render: () => <ChatScene /> },
];

const TRUST = [
  { icon: Fingerprint, label: "Two-step sign-in" },
  { icon: KeyRound, label: "SSO" },
  { icon: Download, label: "Export any time" },
  { icon: ShieldCheck, label: "DPDP & GDPR" },
];

export function AuthShowcase() {
  const [i, setI] = useState(0);
  const scene = SCENES[i]!;
  const next = () => {
    // With reduced motion the timer ends at once — don't spin through the scenes.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setI((n) => (n + 1) % SCENES.length);
  };
  return (
    <section aria-label="What you can do with Cloudesk" className="as-panel relative flex h-full min-h-[640px] flex-col overflow-hidden rounded-[32px] p-10 xl:p-12">
      <div className="p-aurora" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>

      <div className="relative p-in" style={{ animationDelay: "120ms" }}>
        <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.16em] text-fg/50 uppercase">
          <span className="relative grid size-2 place-items-center">
            <span className="as-ping absolute size-2 rounded-full bg-[var(--p-mint-ink)]/50" />
            <span className="size-1.5 rounded-full bg-[var(--p-mint-ink)]" />
          </span>
          One workspace for your whole business
        </p>
        <p className="mt-4 max-w-[30rem] text-[40px] leading-[1.04] font-semibold tracking-[-0.04em] text-fg xl:text-[44px]">
          Run everything.
          <br />
          <span className="text-fg/40">From one calm desk.</span>
        </p>
      </div>

      {/* The stage: drawn at 520×400 and scaled to fit the panel. */}
      <div className="relative mt-6 flex flex-1 items-center justify-center" aria-hidden>
        <div className="h-[310px] xl:h-[400px]">
          <div key={scene.id} className="as-scene relative h-[400px] w-[520px] origin-top scale-[0.76] xl:scale-100">
            {scene.render()}
          </div>
        </div>
      </div>

      <div className="relative">
        <div key={scene.id} className="as-scene min-h-[64px]" aria-live="polite">
          <p className="text-[17px] font-semibold tracking-tight text-fg">{scene.title}</p>
          <p className="mt-1 max-w-[30rem] text-[14px] leading-relaxed text-fg/55">{scene.line}</p>
        </div>

        <div role="tablist" aria-label="Features" className="mt-5 grid grid-cols-4 gap-2">
          {SCENES.map((s, n) => {
            const Icon = s.icon;
            const on = n === i;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setI(n)}
                className={clsx(
                  "group relative overflow-hidden rounded-[14px] px-3 pt-2.5 pb-3 text-left transition-colors duration-300",
                  on ? "p-glass" : "hover:bg-fg/[0.035]",
                )}
              >
                <span className={clsx("flex items-center gap-2 text-[13px] font-semibold transition-colors", on ? "text-fg" : "text-fg/45 group-hover:text-fg/70")}>
                  <span className={clsx("grid size-6 place-items-center rounded-[8px] transition-colors", on ? `tint-${s.tone} bg-[var(--t)] text-[var(--t-ink)]` : "bg-fg/[0.05]")}>
                    <Icon className="size-3.5" />
                  </span>
                  {s.label}
                </span>
                <span className="absolute inset-x-3 bottom-1.5 h-[3px] overflow-hidden rounded-full bg-fg/[0.06]">
                  {on && (
                    <span
                      key={scene.id}
                      className={clsx("as-progress block h-full rounded-full", `tint-${s.tone} bg-[var(--t-ink)]`)}
                      style={{ ["--dur" as string]: `${SCENE_MS}ms` }}
                      onAnimationEnd={next}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <ul className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-fg/50">
          {TRUST.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-1.5">
              <Icon className="size-3.5" aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── Scenes (decorative) ──────────────────────────────────────────────────── */

function Card({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return <div className={clsx("p-glass absolute rounded-[20px]", className)} style={style}>{children}</div>;
}

function Toast({ className, style, icon: Icon, tone, children }: { className?: string; style?: CSSProperties; icon: LucideIcon; tone: string; children: ReactNode }) {
  return (
    <div className={clsx("as-pop p-glass absolute flex items-center gap-2.5 rounded-full py-2 pr-4 pl-2 text-[12px] font-semibold whitespace-nowrap text-fg", className)} style={style}>
      <span className={clsx("grid size-7 place-items-center rounded-full", `tint-${tone} bg-[var(--t)] text-[var(--t-ink)]`)}>
        <Icon className="size-3.5" />
      </span>
      {children}
    </div>
  );
}

function BuildScene() {
  return (
    <>
      <Card className="as-a top-2 left-0 w-[330px] p-3" style={d(0)}>
        <div className="flex items-center gap-1.5 px-1 pb-2.5">
          <span className="size-2 rounded-full bg-[#ff5f57]/70" />
          <span className="size-2 rounded-full bg-[#febc2e]/70" />
          <span className="size-2 rounded-full bg-[#28c840]/70" />
          <span className="ml-2 flex h-5 flex-1 items-center rounded-full bg-fg/[0.05] px-2.5 text-[10px] text-fg/45">sunriseyoga.in</span>
        </div>
        <div className="flex items-center gap-2 rounded-[12px] bg-fg/[0.04] px-3 py-2 text-[11px] text-fg/70">
          <Sparkles className="size-3.5 shrink-0 text-[var(--p-lavender-ink)]" />
          <span className="as-type whitespace-nowrap" style={d(0.3)}>A yoga studio by the sea in Goa</span>
          <span className="as-caret -ml-1 h-3 w-px bg-fg/60" />
        </div>
        <div className="as-a mt-2.5 rounded-[14px] bg-[var(--p-lavender)] p-4" style={d(1.4)}>
          <p className="text-[16px] leading-tight font-semibold tracking-tight text-fg">Sunrise yoga by the sea</p>
          <p className="mt-1 text-[10.5px] text-fg/55">Classes · Retreats · Book a mat</p>
          <span className="mt-3 inline-block rounded-full bg-fg px-3 py-1 text-[10px] font-semibold text-bg">Book a class</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {["var(--p-peach)", "var(--p-mint)", "var(--p-sky)"].map((bg, n) => (
            <div key={n} className="as-a rounded-[10px] p-2" style={{ ...d(1.7 + n * 0.15), background: bg }}>
              <div className="h-7 rounded-[6px] bg-[var(--p-glass)]" />
              <div className="mt-1.5 h-1 w-3/4 rounded-full bg-fg/20" />
            </div>
          ))}
        </div>
      </Card>

      <Card className="as-a top-[118px] right-0 w-[200px] p-3" style={{ ...d(2.3), ["--rot" as string]: "3deg" }}>
        <div className="grid h-24 place-items-center rounded-[14px] bg-[var(--p-peach)]">
          <ShoppingBag className="size-8 text-[var(--p-peach-ink)]" strokeWidth={1.5} />
        </div>
        <div className="flex items-end justify-between px-1 pt-2.5">
          <div>
            <p className="text-[12.5px] font-semibold text-fg">Yoga mat</p>
            <p className="text-[10.5px] text-fg/50">Cork · 6 mm</p>
          </div>
          <p className="text-[12.5px] font-semibold text-fg">₹1,899</p>
        </div>
        <span className="mt-2 block rounded-full bg-fg py-1.5 text-center text-[10.5px] font-semibold text-bg">Add to cart</span>
      </Card>

      <Toast className="top-[300px] left-[44px]" style={d(3.1)} icon={Globe} tone="lavender">Published · sunriseyoga.in</Toast>
      <Toast className="top-[346px] left-[200px]" style={d(3.8)} icon={Store} tone="mint">New order #1042 · ₹1,899 paid</Toast>
    </>
  );
}

function BillScene() {
  const rows: [string, string][] = [
    ["Brand design retainer", "₹40,000"],
    ["Website care · Oct", "₹2,500"],
  ];
  const tax: [string, string][] = [
    ["CGST 9%", "₹3,825"],
    ["SGST 9%", "₹3,825"],
  ];
  return (
    <>
      <Card className="as-a top-0 left-[20px] w-[320px] p-5" style={d(0)}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-fg/45 uppercase">Tax invoice</p>
            <p className="mt-1 text-[15px] font-semibold text-fg">INV-0231</p>
          </div>
          <span className="tint-peach grid size-8 place-items-center rounded-[10px] bg-[var(--t)] text-[var(--t-ink)]">
            <ReceiptText className="size-4" />
          </span>
        </div>
        <p className="mt-3 text-[11px] text-fg/55">Billed to <span className="font-semibold text-fg/80">Studio Verma</span> · Maharashtra</p>
        <div className="mt-4 grid gap-2 text-[12px]">
          {rows.map(([a, b], n) => (
            <div key={a} className="as-a flex justify-between" style={d(0.4 + n * 0.2)}>
              <span className="text-fg/70">{a}</span>
              <span className="font-medium text-fg tabular-nums">{b}</span>
            </div>
          ))}
          <div className="as-grow my-1 h-px bg-fg/10" style={d(0.9)} />
          {tax.map(([a, b], n) => (
            <div key={a} className="as-a flex justify-between text-[11.5px]" style={d(1.1 + n * 0.2)}>
              <span className="text-fg/50">{a}</span>
              <span className="text-fg/70 tabular-nums">{b}</span>
            </div>
          ))}
          <div className="as-a mt-1 flex items-baseline justify-between rounded-[12px] bg-fg/[0.04] px-3 py-2.5" style={d(1.6)}>
            <span className="text-[12px] font-semibold text-fg/70">Total</span>
            <span className="text-[18px] font-semibold tracking-tight text-fg tabular-nums">₹50,150</span>
          </div>
        </div>
        <span
          className="as-pop absolute top-5 right-16 rounded-[10px] border-2 border-[var(--p-mint-ink)]/60 px-2.5 py-1 text-[12px] font-bold tracking-[0.12em] text-[var(--p-mint-ink)] uppercase"
          style={{ ...d(2.6), ["--rot" as string]: "-10deg" }}
        >
          Paid
        </span>
      </Card>

      <Card className="as-a top-[60px] right-0 w-[170px] p-4" style={d(1.9)}>
        <p className="text-[10.5px] font-semibold text-fg/50">Collected · Oct</p>
        <p className="mt-1 text-[19px] font-semibold tracking-tight text-fg">₹4.2L</p>
        <div className="mt-3 flex h-16 items-end gap-1.5">
          {[38, 52, 44, 70, 58, 86, 100].map((h, n) => (
            <span key={n} className="as-bar tint-peach flex-1 rounded-t-[4px] bg-[var(--t)]" style={{ ...d(2.1 + n * 0.07), height: `${h}%`, ...(n === 6 ? { background: "var(--p-peach-ink)" } : {}) }} />
          ))}
        </div>
      </Card>

      <Toast className="top-[318px] left-[60px]" style={d(3.1)} icon={Check} tone="mint">₹50,150 received · INV-0231 paid</Toast>
      <Toast className="top-[250px] right-[6px]" style={d(3.7)} icon={LayoutGrid} tone="butter">Books updated</Toast>
    </>
  );
}

function MailScene() {
  const links = [
    { y: 70, icon: NotebookPen, tone: "butter", title: "Saved to Notes", sub: "With 3 to-dos", at: 1.2 },
    { y: 170, icon: CalendarDays, tone: "sky", title: "Thu, 4:00 PM", sub: "Meet link added", at: 1.8 },
    { y: 270, icon: Hash, tone: "lavender", title: "Shared in #launch", sub: "Ravi and 4 others", at: 2.4 },
  ];
  return (
    <>
      <svg className="absolute inset-0" width="520" height="400" viewBox="0 0 520 400" fill="none">
        {links.map((l) => {
          const path = `M262 ${170 + 10} C 300 180, 300 ${l.y + 22}, 330 ${l.y + 22}`;
          return (
            <g key={l.y}>
              <path d={path} className="as-draw" style={d(l.at - 0.4)} stroke="currentColor" strokeOpacity="0.12" strokeWidth="2" />
              <path d={path} className="as-flow" style={d(l.at)} stroke={`var(--p-${l.tone}-ink)`} strokeOpacity="0.75" strokeWidth="2" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>

      <Card className="as-a top-[60px] left-0 w-[262px] p-4" style={d(0)}>
        <div className="flex items-center gap-2.5">
          <span className="tint-sky grid size-8 place-items-center rounded-full bg-[var(--t)] text-[11px] font-bold text-[var(--t-ink)]">AV</span>
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-fg">Asha Verma</p>
            <p className="text-[10.5px] text-fg/45">to you, Ravi · 10:24</p>
          </div>
        </div>
        <p className="mt-3 text-[14px] font-semibold tracking-tight text-fg">Launch plan for Diwali</p>
        <div className="mt-2 grid gap-1.5 text-[11px] text-fg/60">
          <p>Here&apos;s what we agreed:</p>
          <p>• Final designs by Friday</p>
          <p>• Ads go live on the 5th</p>
          <p>
            Can we meet <span className="as-a rounded bg-[var(--p-sky)] px-1 font-semibold text-[var(--p-sky-ink)]" style={d(1.6)}>Thursday at 4pm</span>?
          </p>
        </div>
        <div className="mt-3 flex gap-1.5">
          {["Notes", "Calendar", "Chat"].map((t, n) => (
            <span key={t} className="as-a rounded-full bg-fg/[0.05] px-2 py-0.5 text-[10px] font-semibold text-fg/55" style={d(0.5 + n * 0.12)}>+ {t}</span>
          ))}
        </div>
      </Card>

      {links.map(({ y, icon: Icon, tone, title, sub, at }) => (
        <div key={y} className="as-pop p-glass absolute right-0 flex w-[186px] items-center gap-2.5 rounded-[16px] p-2.5" style={{ ...d(at), top: y }}>
          <span className={clsx("grid size-8 shrink-0 place-items-center rounded-[10px]", `tint-${tone} bg-[var(--t)] text-[var(--t-ink)]`)}>
            <Icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-fg">{title}</span>
            <span className="block truncate text-[10.5px] text-fg/50">{sub}</span>
          </span>
          <Check className="ml-auto size-3.5 shrink-0 text-[var(--p-mint-ink)]" />
        </div>
      ))}

      <Toast className="top-[352px] left-[24px]" style={d(3.2)} icon={Repeat} tone="peach">Weekly update · repeats Mondays, 9:00</Toast>
    </>
  );
}

function ChatScene() {
  return (
    <>
      <Card className="as-a top-0 left-0 w-[316px] overflow-hidden" style={d(0)}>
        <div className="flex items-center justify-between border-b border-fg/[0.06] px-4 py-3">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
            <Hash className="size-3.5 text-fg/45" /> diwali-launch
          </span>
          <span className="flex items-center gap-1 rounded-full bg-[var(--p-lavender)] px-2 py-0.5 text-[10px] font-semibold text-[var(--p-lavender-ink)]">
            <Sparkles className="size-3" /> Catch me up
          </span>
        </div>
        <div className="grid gap-3 p-4">
          <Bubble who="RK" tone="peach" name="Ravi" at={0.4}>Final designs are in — have a look 🎨</Bubble>
          <div className="as-a ml-9 flex items-center gap-2.5 rounded-[12px] border border-fg/[0.07] bg-fg/[0.025] p-2.5" style={d(1)}>
            <span className="tint-peach grid size-7 place-items-center rounded-[8px] bg-[var(--t)] text-[var(--t-ink)]"><ReceiptText className="size-3.5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] font-semibold text-fg">INV-0231 · ₹50,150</span>
              <span className="block text-[10px] text-fg/50">Invoice · Studio Verma</span>
            </span>
            <span className="rounded-full bg-[var(--p-mint)] px-2 py-0.5 text-[9.5px] font-semibold text-[var(--p-mint-ink)]">Paid</span>
          </div>
          <div className="as-a flex justify-end" style={d(1.6)}>
            <span className="max-w-[80%] rounded-[14px] rounded-br-[4px] bg-fg px-3 py-2 text-[11.5px] text-bg">Looks great. Shipping Friday 🚀</span>
          </div>
          <Bubble who="PS" tone="mint" name="Priya · guest" at={4.1}>Thanks for adding me! 👋</Bubble>
        </div>
      </Card>

      {/* A guest asks to join; the admin approves. */}
      <Card className="as-a top-[176px] right-0 w-[192px] p-3.5" style={{ ...d(2.2), ["--rot" as string]: "2deg" }}>
        <div className="flex items-center gap-2">
          <span className="tint-mint grid size-8 place-items-center rounded-full bg-[var(--t)] text-[var(--t-ink)]"><UserPlus className="size-4" /></span>
          <span>
            <span className="block text-[12px] font-semibold text-fg">Priya Shah</span>
            <span className="block text-[10.5px] text-fg/50">wants to join as a guest</span>
          </span>
        </div>
        <div className="relative mt-3 h-8">
          <span className="as-out absolute inset-0 grid place-items-center rounded-full bg-fg text-[11px] font-semibold text-bg" style={d(3.4)}>Approve</span>
          <span className="as-pop absolute inset-0 flex items-center justify-center gap-1.5 rounded-full bg-[var(--p-mint)] text-[11px] font-semibold text-[var(--p-mint-ink)]" style={d(3.5)}>
            <Check className="size-3.5" /> Approved
          </span>
        </div>
      </Card>

      <Toast className="top-[350px] left-[30px]" style={d(0.9)} icon={Users} tone="lavender">Invite link · share on WhatsApp or email</Toast>
      <Toast className="top-[300px] right-[6px]" style={d(2.8)} icon={Sparkles} tone="sky">AI · 3 action items</Toast>
    </>
  );
}

function Bubble({ who, tone, name, at, children }: { who: string; tone: string; name: string; at: number; children: ReactNode }) {
  return (
    <div className="as-a flex items-start gap-2" style={d(at)}>
      <span className={clsx("grid size-7 shrink-0 place-items-center rounded-full text-[9.5px] font-bold", `tint-${tone} bg-[var(--t)] text-[var(--t-ink)]`)}>{who}</span>
      <div className="min-w-0">
        <p className="text-[10.5px] font-semibold text-fg/55">{name}</p>
        <p className="mt-0.5 inline-block rounded-[14px] rounded-tl-[4px] bg-fg/[0.05] px-3 py-2 text-[11.5px] text-fg/85">{children}</p>
      </div>
    </div>
  );
}

/* ── Phones and tablets: a quiet strip of what's inside ───────────────────── */

const STRIP: { icon: LucideIcon; label: string; tone: string }[] = [
  { icon: Globe, label: "Websites", tone: "lavender" },
  { icon: ShoppingBag, label: "Online store", tone: "peach" },
  { icon: Store, label: "Point of sale", tone: "mint" },
  { icon: ReceiptText, label: "GST invoicing", tone: "butter" },
  { icon: Mail, label: "Mail", tone: "sky" },
  { icon: CalendarDays, label: "Calendar", tone: "sky" },
  { icon: MessagesSquare, label: "Chat", tone: "lavender" },
  { icon: NotebookPen, label: "Notes", tone: "butter" },
  { icon: Users, label: "CRM", tone: "rose" },
  { icon: LayoutGrid, label: "Inventory", tone: "mint" },
  { icon: Sparkles, label: "AI built in", tone: "peach" },
];

export function AuthStrip() {
  const row = (hidden?: boolean) => (
    <ul className="flex shrink-0 gap-2 pr-2" aria-hidden={hidden || undefined}>
      {STRIP.map(({ icon: Icon, label, tone }) => (
        <li key={label} className="p-glass flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-[12.5px] font-medium whitespace-nowrap text-fg/75">
          <span className={clsx("grid size-6 place-items-center rounded-full", `tint-${tone} bg-[var(--t)] text-[var(--t-ink)]`)}>
            <Icon className="size-3.5" aria-hidden />
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-label="What's inside Cloudesk" className="as-strip relative">
      {/* Tablets have the room for the four big ideas. */}
      <ul className="mx-auto mb-8 hidden max-w-[600px] grid-cols-2 gap-3 px-5 sm:grid">
        {SCENES.map((sc, n) => {
          const Icon = sc.icon;
          return (
            <li key={sc.id} className="as-a p-glass rounded-[20px] p-4" style={d(0.3 + n * 0.1)}>
              <span className={clsx("grid size-8 place-items-center rounded-[10px]", `tint-${sc.tone} bg-[var(--t)] text-[var(--t-ink)]`)}>
                <Icon className="size-4" aria-hidden />
              </span>
              <p className="mt-3 text-[14px] font-semibold tracking-tight text-fg">{sc.title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg/55">{sc.line}</p>
            </li>
          );
        })}
      </ul>
      <p className="px-5 text-center text-[13px] text-fg/55">
        <span className="font-semibold text-fg/80">One sign-in</span> for everything your business runs on
      </p>
      <div className="as-mask mt-3 overflow-hidden py-2">
        <div className="as-marquee flex w-max">
          {row()}
          {row(true)}
        </div>
      </div>
    </section>
  );
}
