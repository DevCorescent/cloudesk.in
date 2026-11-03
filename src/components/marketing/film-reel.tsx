"use client";

// The homepage's last section: the short feature films, each playing inside
// an iPhone 17 with a badge in its own colour, in one row across the full
// width of the screen. One film is in focus at a time — in the middle, sharp
// and full size, with only its details and its way in (to its feature page)
// shown below; the rest sit back, blurred. On large screens the section pins
// and scrolling moves the next film into the middle; on phones it's a
// swipeable row that snaps to the middle. Films only load and play while
// they're on screen (muted, as browsers require); "Sound on" unmutes the one
// in focus. Reduced motion: no pinning, and nothing plays by itself.
import clsx from "clsx";
import { ArrowRight, Boxes, Briefcase, CalendarDays, Camera, Globe, Handshake, IndianRupee, Mail, MessagesSquare, NotebookPen, Pause, Play, ShoppingBag, Sparkles, Users, UtensilsCrossed, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IPhone17 } from "./iphone";
import { W } from "./sections";

type Film = { key: string; label: string; icon: LucideIcon; hook: string; line: string; secs: number; href: string; cta?: { label: string; href: string }; tone: string };

/** Films are in public/marketing/films (540×960, made from video/out). */
const FILMS: Film[] = [
  { key: "website", label: "Website builder", icon: Globe, hook: "Four weeks. Still no website.", line: "Describe it, drag it into shape, publish it — a site in an afternoon.", secs: 54, href: "/features/website-builder", tone: "#7c6be0" },
  { key: "store", label: "Online store", icon: ShoppingBag, hook: "Weeks to build. A cut of every sale.", line: "Products, UPI checkout, orders and delivery — and no commission.", secs: 58, href: "/features/online-store", tone: "#e8774a" },
  { key: "crm-sales", label: "CRM & sales", icon: Users, hook: "Leads in chats. Deals in spreadsheets.", line: "Leads arrive by themselves; deals move across one board.", secs: 80, href: "/features/crm", tone: "#3b7ddd" },
  { key: "money", label: "Money & GST", icon: IndianRupee, hook: "Invoices in Word. Books at year-end.", line: "GST invoices, UPI links and books that keep themselves.", secs: 86, href: "/features/invoicing", tone: "#1f9d6b" },
  { key: "people-work", label: "People & work", icon: Briefcase, hook: "Leave on WhatsApp. Payroll on a Sunday.", line: "Attendance, leave and payroll for India, in one run.", secs: 90, href: "/features/hrms", tone: "#c98a1c" },
  { key: "operations", label: "Operations", icon: Boxes, hook: "Stock in a register. Fixed when it breaks.", line: "Stock in every location, reordered before it runs out.", secs: 86, href: "/features/inventory", tone: "#c94f6d" },
  { key: "horeca", label: "Restaurants & hotels", icon: UtensilsCrossed, hook: "Paper tickets. Six apps. One busy night.", line: "Tables, QR orders and the kitchen screen — one system.", secs: 90, href: "/features/horeca", tone: "#e8774a" },
  { key: "mail", label: "Mail", icon: Mail, hook: "1,284 unread. Deep breath.", line: "Every inbox in one place, sorted before you look.", secs: 46, href: "/features/mail", tone: "#3b7ddd" },
  { key: "calendar", label: "Calendar", icon: CalendarDays, hook: "Double-booked. Again?", line: "Invites from your email, reminders and minutes.", secs: 48, href: "/features/calendar", tone: "#1f9d6b" },
  { key: "chat", label: "Chat", icon: MessagesSquare, hook: "37 groups. 12 apps. One headache.", line: "Channels with the work in them — and guests by link.", secs: 48, href: "/features/chat", tone: "#7c6be0" },
  { key: "notes", label: "Notes", icon: NotebookPen, hook: "Ideas everywhere. Found nowhere.", line: "Notes that fill your day in and do the follow-up.", secs: 48, href: "/features/notes", tone: "#c98a1c" },
  { key: "ai", label: "Copilot", icon: Sparkles, hook: "Invoices. Emails. Stock. Your brain called.", line: "Ask your business anything, in plain words.", secs: 46, href: "/features/copilot", tone: "#9b5de5" },
  { key: "ai-camera", label: "AI camera", icon: Camera, hook: "Bills in your pocket. Cards on the desk.", line: "Snap a bill or a business card — it fills itself in.", secs: 60, href: "/features/copilot", tone: "#3b7ddd" },
  { key: "partner", label: "Partner program", icon: Handshake, hook: "You recommend software. Someone else gets paid.", line: "Recommend Cloudesk to businesses, and earn every month.", secs: 54, href: "/partners", cta: { label: "Become a partner", href: "/partners#apply" }, tone: "#1f9d6b" },
];
const PIN = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function FilmReel() {
  const pinBox = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const vids = useRef<(HTMLVideoElement | null)[]>([]);
  const [pinned, setPinned] = useState(false);
  const [at, setAt] = useState(0);
  const [sound, setSound] = useState(false);
  const [stopped, setStopped] = useState(false);
  const reduce = useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const n = FILMS.length;

  useEffect(() => {
    const mq = window.matchMedia(PIN);
    const sync = () => setPinned(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Large screens: pin the section; scrolling slides the row so the film in focus sits in the middle.
  useEffect(() => {
    const box = pinBox.current;
    const t = track.current;
    if (!pinned || !box || !t) return;
    let raf = 0;
    const measure = () => {
      const [a, b] = Array.from(t.children) as HTMLElement[];
      if (!a || !b) return;
      const step = b.offsetLeft - a.offsetLeft;
      box.dataset.step = String(step);
      box.dataset.first = String(a.offsetLeft + a.offsetWidth / 2);
      box.style.height = `${innerHeight + step * (n - 1)}px`;
    };
    const update = () => {
      raf = 0;
      const step = Number(box.dataset.step || 0);
      const travel = step * (n - 1);
      const p = Math.min(1, Math.max(0, -box.getBoundingClientRect().top / Math.max(1, travel)));
      t.style.transform = `translate3d(${t.clientWidth / 2 - Number(box.dataset.first || 0) - p * travel}px,0,0)`;
      box.style.setProperty("--p", p.toFixed(4));
      setAt(Math.round(p * (n - 1)));
    };
    const on = () => void (raf ||= requestAnimationFrame(update));
    const onResize = () => (measure(), on());
    measure();
    update();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", onResize);
    return () => {
      removeEventListener("scroll", on);
      removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      box.style.height = "";
      t.style.transform = "";
    };
  }, [pinned, n]);

  // Otherwise: the film in focus is the one nearest the middle of the row.
  useEffect(() => {
    const t = track.current;
    if (!t || pinned) return;
    const onScroll = () => {
      const mid = t.scrollLeft + t.clientWidth / 2;
      const cards = Array.from(t.children) as HTMLElement[];
      let best = 0;
      cards.forEach((c, k) => {
        if (Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(cards[best]!.offsetLeft + cards[best]!.offsetWidth / 2 - mid)) best = k;
      });
      setAt(best);
    };
    onScroll();
    t.addEventListener("scroll", onScroll, { passive: true });
    return () => t.removeEventListener("scroll", onScroll);
  }, [pinned]);

  // Films load and play only while on screen.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.isIntersecting && !reduce && !stopped) {
            if (v.preload !== "auto") v.preload = "auto";
            void v.play().catch(() => {});
          } else v.pause();
        }
      },
      { threshold: 0.45 },
    );
    vids.current.forEach((v) => v && io.observe(v));
    return () => io.disconnect();
  }, [reduce, stopped]);

  // Sound, only for the film in focus.
  useEffect(() => {
    vids.current.forEach((v, k) => {
      if (!v) return;
      v.muted = !(sound && k === at);
      if (sound && k === at && v.paused && !stopped) void v.play().catch(() => {});
    });
  }, [sound, at, stopped]);

  const toggleStop = () => {
    const next = !stopped;
    setStopped(next);
    if (next) vids.current.forEach((v) => v?.pause());
  };
  const go = (k: number) => {
    const target = Math.max(0, Math.min(n - 1, k));
    if (pinned) {
      const box = pinBox.current;
      if (!box) return;
      const step = Number(box.dataset.step || 0);
      scrollTo({ top: box.getBoundingClientRect().top + scrollY + target * step, behavior: "smooth" });
      return;
    }
    const t = track.current;
    const c = t?.children[target] as HTMLElement | undefined;
    if (t && c) t.scrollTo({ left: c.offsetLeft - (t.clientWidth - c.offsetWidth) / 2, behavior: "smooth" });
  };
  const cur = FILMS[at]!;
  const Icon = cur.icon;

  return (
    <section id="films" aria-labelledby="films-title" className="relative py-10 sm:py-14">
      <div ref={pinBox} className="relative">
        {/* Pinned just under the site header (h-14). The soft edges are on the background only, so they never fade the buttons. */}
        <div className={clsx("relative isolate overflow-hidden", pinned ? "sticky top-14 flex h-[calc(100dvh-3.5rem)] flex-col justify-center py-4" : "py-14")}>
          <span aria-hidden className="fr-band pointer-events-none absolute inset-0 -z-10" />
          <span aria-hidden className="fr-glow pointer-events-none absolute inset-0 -z-10" style={{ ["--fr" as string]: cur.tone }} />
          <div className={clsx(W, "flex flex-wrap items-end justify-between gap-5")}>
            <div className="min-w-0 max-w-2xl flex-[1_1_320px]">
              <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Watch it work</p>
              <h2 id="films-title" className="mt-3 text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.04] font-[360] tracking-[-0.045em] text-balance">One minute each. <span className="mk-logo-gradient">Every part of your business.</span></h2>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSound(!sound)} aria-pressed={sound} className="inline-flex h-10 items-center gap-2 rounded-full bg-white/80 px-4 text-[13.5px] font-medium ring-1 ring-fg/[0.08] backdrop-blur transition-colors hover:bg-white">
                {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} {sound ? "Sound on" : "Sound off"}
              </button>
              <button type="button" onClick={toggleStop} aria-label={stopped ? "Play the films" : "Pause the films"} className="grid size-10 place-items-center rounded-full bg-white/80 ring-1 ring-fg/[0.08] backdrop-blur transition-colors hover:bg-white">
                {stopped ? <Play className="size-4 translate-x-px" /> : <Pause className="size-4" />}
              </button>
            </div>
          </div>

          {/* The row: one film in focus in the middle, the rest blurred either side. */}
          <ul ref={track} aria-label="Feature films" className={clsx("mt-9 flex items-center gap-5 sm:gap-8 lg:mt-10 lg:gap-12", pinned ? "will-change-transform" : "fr-free snap-x snap-mandatory overflow-x-auto pt-6 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}>
            {FILMS.map((f, k) => (
              <li key={f.key} data-on={k === at || undefined} className="fr-card shrink-0 snap-center" style={{ ["--fr" as string]: f.tone }}>
                <button type="button" onClick={() => go(k)} className="block w-full text-left" aria-label={`${f.label}: ${f.hook}`} aria-current={k === at || undefined}>
                  <div className="relative pt-4">
                    {/* Its badge, kept sharp even when the phone is blurred */}
                    <span className="fr-badge absolute top-0 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[12px] font-semibold whitespace-nowrap text-white">
                      <span className="grid size-6 place-items-center rounded-full bg-white/20"><f.icon className="size-3.5" /></span>
                      {f.label}
                    </span>
                    <div className="fr-phone relative">
                      <IPhone17 color={k % 3 === 1 ? "white" : k % 3 === 2 ? "lavender" : "black"}>
                        <video
                          ref={(el) => void (vids.current[k] = el)}
                          className="absolute inset-0 size-full object-cover"
                          src={`/marketing/films/${f.key}.mp4`}
                          poster={`/marketing/films/${f.key}.jpg`}
                          muted
                          loop
                          playsInline
                          preload="none"
                          aria-hidden
                        />
                      </IPhone17>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Only the film in focus: what it shows, and the way in. */}
          <div className={clsx(W, "mt-6 sm:mt-8")} aria-live="polite">
            <div key={cur.key} className="fr-info mx-auto flex max-w-xl flex-col items-center text-center">
              <p className="inline-flex items-center gap-2 text-[12px] font-medium tracking-[0.12em] text-fg/45 uppercase">
                <span className="grid size-6 place-items-center rounded-full text-white" style={{ background: cur.tone }}><Icon className="size-3.5" /></span>
                {cur.label}
                <span className="h-px w-5 bg-fg/20" />
                <span className="tabular-nums">{mmss(cur.secs)} film</span>
              </p>
              <h3 className="mt-3 text-[clamp(1.25rem,2.2vw,1.75rem)] leading-[1.15] font-[400] tracking-[-0.03em] text-balance">{cur.hook}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-fg/58">{cur.line}</p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <Link href={cur.cta?.href ?? cur.href} className="inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14.5px] font-semibold text-white shadow-[0_14px_30px_-14px_var(--fr)] transition-transform hover:-translate-y-0.5" style={{ background: cur.tone, ["--fr" as string]: cur.tone }}>
                  {cur.cta?.label ?? `Explore ${cur.label}`} <ArrowRight className="size-4" />
                </Link>
                <Link href={cur.cta ? cur.href : "/start"} className="inline-flex h-11 items-center rounded-full bg-white/80 px-5 text-[14px] font-medium ring-1 ring-fg/[0.1] backdrop-blur transition-colors hover:bg-white">
                  {cur.cta ? "How it works" : "Start free"}
                </Link>
              </div>
            </div>
            <div className="mx-auto mt-7 flex max-w-sm items-center gap-3" aria-hidden>
              <span className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-fg/[0.08]">
                {pinned ? <span className="fr-progress absolute inset-0 origin-left rounded-full bg-fg" /> : <span className="absolute inset-y-0 left-0 rounded-full bg-fg transition-[width] duration-500" style={{ width: `${((at + 1) / n) * 100}%` }} />}
              </span>
              <span className="text-[12.5px] text-fg/45 tabular-nums"><b className="font-medium text-fg">{String(at + 1).padStart(2, "0")}</b> / {String(n).padStart(2, "0")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
