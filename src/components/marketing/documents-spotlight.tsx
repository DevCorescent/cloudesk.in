"use client";

// The homepage's Documents band: real screens from the app, one per panel,
// on soft pastel glass. On wide screens the band holds still while you scroll
// and the panels glide sideways (eased, so it feels smooth rather than tied
// to the wheel), with a progress bar and steps you can click. On phones —
// and for anyone who prefers less motion — it's a plain swipeable row.
import clsx from "clsx";
import { ArrowRight, Check, FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PhoneFrame } from "./phone-deck";
import { ShotFrame, type Shot } from "./shot-tour";
import { W } from "./sections";

type Zoom = { s: number; x: number; y: number };
type Panel = { id: string; step: string; title: string; body: string; points: string[]; tone: string; shot: Shot; zoom?: Zoom; url: string; side?: { shot: Shot; zoom?: Zoom; label: string }; phone?: string };

const shot = (name: string, alt: string): Shot => ({ src: `/marketing/documents/${name}.jpg`, w: 2880, h: 1800, alt });

const PANELS: Panel[] = [
  {
    id: "live",
    step: "Write together",
    title: "Write together, live",
    body: "Everyone’s cursor and changes appear as they type. Comment on a line, @mention someone, and it saves itself as you go.",
    points: ["Live cursors and presence", "Comments and @mentions", "Saves as you type"],
    tone: "lavender",
    shot: shot("live", "A proposal being edited by Asha while Bilal Khan types, with a comment thread open"),
    url: "cloudesk · Proposal — Rao Interiors",
    phone: "/marketing/phones/documents-editor.jpg",
  },
  {
    id: "drive",
    step: "Organise",
    title: "A drive that keeps itself tidy",
    body: "Private until you share. Team folders follow their own rules, and every file shows who changed it and when.",
    points: ["My documents, Team and Shared", "View, comment or edit shares", "Stars, recents and a 30-day trash"],
    tone: "sky",
    shot: shot("drive", "A client's folder with proposals, an NDA, a survey PDF, a budget sheet and mood boards"),
    url: "cloudesk · Documents",
    phone: "/marketing/phones/documents-drive.jpg",
  },
  {
    id: "write",
    step: "Templates",
    title: "Start from what you’d write anyway",
    body: "Proposals, NDAs, service agreements, offer letters and SOPs — fill in the blanks once, and add tables, images or page breaks from the “/” menu.",
    points: ["9 ready templates", "Fill-in {{fields}}", "Tables, images, page breaks"],
    tone: "butter",
    shot: shot("slash", "The “/” menu of blocks open in the proposal"),
    url: "cloudesk · Proposal — Rao Interiors",
  },
  {
    id: "versions",
    step: "Versions",
    title: "Every version kept",
    body: "A version every ten minutes of editing, or whenever you name one. Open any of them and bring it back in a click.",
    points: ["Named versions", "Preview before you restore", "Nothing is ever lost"],
    tone: "mint",
    shot: shot("versions", "Version history with a named version, “Sent to Mr Rao”"),
    url: "cloudesk · Proposal — Rao Interiors",
  },
  {
    id: "preview",
    step: "Preview",
    title: "Open anything, right here",
    body: "PDFs with pages, thumbnails and find; spreadsheets as tables with every sheet; Word files as pages — no downloads to check a file.",
    points: ["PDF, Word, Excel, slides, text", "Select and search text in PDFs", "← → through the folder"],
    tone: "peach",
    shot: shot("pdf", "A site survey PDF open in the viewer with page thumbnails"),
    url: "cloudesk · Site survey",
    side: { shot: shot("sheet", "A budget spreadsheet shown as a table"), zoom: { s: 2.3, x: 50, y: 4 }, label: "Budget.xlsx" },
  },
  {
    id: "pdf",
    step: "PDF tools",
    title: "Fix PDFs page by page",
    body: "Rotate, delete and drag pages into order, then save it as a new version — the old one stays. Split, merge, watermark and number them too.",
    points: ["Rotate, delete, reorder", "Split, merge, extract", "Watermark and page numbers"],
    tone: "rose",
    shot: shot("pdftools", "PDF tools with two pages selected and rotated"),
    zoom: { s: 1.9, x: 0, y: 0 },
    url: "cloudesk · PDF tools",
  },
  {
    id: "share",
    step: "Convert & share",
    title: "Convert it, then share it by QR",
    body: "Turn any file into PDF, Word, Excel, CSV or Markdown, saved next to the original — and open it anywhere with a QR code or a read-only link.",
    points: ["8 formats", "QR for your team or anyone", "Links you can turn off"],
    tone: "lavender",
    shot: shot("convert", "Converting a budget spreadsheet to PDF, Excel, CSV, JSON or an editable document"),
    url: "cloudesk · Budget",
    side: { shot: shot("qr", "A QR code that opens the site survey"), zoom: { s: 2.05, x: 48, y: 52 }, label: "Scan to open" },
  },
];

/** Pins the band and glides its panels sideways on wide screens; off on phones and for reduced motion. */
function usePinnedScroll(count: number) {
  const outer = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [pin, setPin] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const dist = useRef(0);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setPin(wide.matches && !calm.matches);
    decide();
    wide.addEventListener("change", decide);
    calm.addEventListener("change", decide);
    return () => {
      wide.removeEventListener("change", decide);
      calm.removeEventListener("change", decide);
    };
  }, []);

  useEffect(() => {
    const t = track.current;
    const o = outer.current;
    if (!pin || !t || !o) return;
    const measure = () => {
      dist.current = Math.max(0, t.scrollWidth - t.clientWidth);
      setHeight(window.innerHeight + dist.current);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    window.addEventListener("resize", measure);
    let current = 0;
    let shownStep = -1;
    let frame = 0;
    const tick = () => {
      const r = o.getBoundingClientRect();
      const span = Math.max(1, r.height - window.innerHeight);
      const p = Math.min(1, Math.max(0, -r.top / span));
      const target = p * dist.current;
      // Eased toward where the scroll says — smooth on wheels and trackpads alike.
      current += (target - current) * 0.12;
      if (Math.abs(target - current) < 0.3) current = target;
      t.style.transform = `translate3d(${-current}px,0,0)`;
      const shown = dist.current ? current / dist.current : 0;
      o.style.setProperty("--p", String(shown));
      const step = Math.min(count - 1, Math.round(shown * (count - 1)));
      if (step !== shownStep) {
        shownStep = step;
        setActive(step);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      t.style.transform = "";
    };
  }, [pin, count]);

  /** Scrolls the page (or the row) to show panel i. */
  const go = (i: number) => {
    const o = outer.current;
    if (!o) return;
    if (!pin) {
      const t = track.current;
      const kid = t?.children[i] as HTMLElement | undefined;
      if (t && kid) t.scrollTo({ left: kid.offsetLeft - t.offsetLeft - 20, behavior: "smooth" });
      return;
    }
    const top = o.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + (i / (count - 1)) * (o.offsetHeight - window.innerHeight), behavior: "smooth" });
  };

  return { outer, track, pin, height, active, go, setActive };
}

export function DocumentsSpotlight() {
  const { outer, track, pin, height, active, go, setActive } = usePinnedScroll(PANELS.length);
  // On the swipe row, the panel nearest the left edge is the current one.
  const onRowScroll = () => {
    const t = track.current;
    if (!t || pin) return;
    const w = (t.firstElementChild as HTMLElement | null)?.offsetWidth ?? 1;
    setActive(Math.min(PANELS.length - 1, Math.round(t.scrollLeft / (w + 16))));
  };
  return (
    <section id="documents" aria-labelledby="documents-title" className="relative">
      <div ref={outer} data-pin={pin || undefined} className="relative" style={pin && height ? { height } : undefined}>
        <div className={clsx("relative flex flex-col overflow-hidden", pin ? "sticky top-0 h-[100dvh] justify-center py-6" : "py-20 sm:py-24")}>
          {/* Soft pastel light that shifts with the panel you're on. */}
          <div aria-hidden className="mk-dsx-bg pointer-events-none absolute inset-0" style={{ "--tone": `var(--p-${PANELS[active]!.tone})` } as CSSProperties} />

          <div className={clsx(W, "relative")}>
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <div className="w-full min-w-0 max-w-2xl sm:w-auto sm:flex-1">
                <p className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-[12.5px] font-medium text-[var(--p-lavender-ink)] shadow-sm ring-1 ring-fg/[0.06] backdrop-blur">
                  <FileText className="size-3.5" /> New · Cloudesk Documents
                </p>
                <h2 id="documents-title" className="mt-4 text-[clamp(1.75rem,7.4vw,2.4rem)] leading-[1.08] font-[380] tracking-[-0.035em] text-pretty sm:text-[clamp(2.2rem,3.6vw,3.1rem)] sm:leading-[1.05] sm:tracking-[-0.04em] sm:text-balance">
                  Write it, share it, sign it<span className="hidden sm:inline"> —</span> <span className="block text-fg/45 sm:inline">documents that do the work.</span>
                </h2>
              </div>
              <div className="flex w-full gap-2.5 sm:w-auto sm:shrink-0">
                <Link href="/features/documents" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-fg whitespace-nowrap sm:flex-none px-5 text-[14.5px] font-semibold text-bg transition-transform hover:scale-[1.02]">
                  <span>Explore<span className="hidden min-[370px]:inline"> Documents</span></span> <ArrowRight className="size-4" />
                </Link>
                <Link href="/start" className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-white/70 whitespace-nowrap px-5 text-[14.5px] font-medium ring-1 ring-fg/[0.08] backdrop-blur transition-colors hover:bg-white sm:flex-none">
                  Try it free
                </Link>
              </div>
            </div>
          </div>

          {/* The panels */}
          <div
            ref={track}
            onScroll={onRowScroll}
            className={clsx(
              "relative mt-8 flex gap-4 lg:mt-9 lg:gap-6",
              pin ? "px-14 will-change-transform xl:px-20 min-[1600px]:px-[calc((100vw-1600px)/2+80px)]" : "snap-x snap-mandatory overflow-x-auto scroll-px-5 px-5 pt-2 pb-6 [scrollbar-width:none] sm:scroll-px-8 sm:px-8 [&::-webkit-scrollbar]:hidden",
            )}
          >
            {PANELS.map((p, i) => (
              <PanelCard key={p.id} p={p} n={i} on={active === i} />
            ))}
            {/* The track's end padding isn't counted in its scroll width, so a spacer lets the last panel come to rest centred. */}
            <span aria-hidden className="shrink-0" style={{ width: pin ? "max(24px, calc((100vw - min(1180px, 100vw - 220px)) / 2 - 24px))" : 4 }} />
          </div>

          {/* Progress and steps */}
          <div className={clsx(W, "relative mt-4 lg:mt-7")}>
            <div className="mx-auto max-w-[1180px]">
              <div className="relative h-[3px] overflow-hidden rounded-full bg-fg/[0.08] max-lg:hidden">
                <span className="mk-dsx-bar absolute inset-y-0 left-0 rounded-full" />
              </div>
              <nav aria-label="Documents features" className="mt-3 flex justify-center gap-1.5 lg:justify-between lg:gap-2">
                {PANELS.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => go(i)}
                    aria-current={active === i ? "step" : undefined}
                    aria-label={p.step}
                    className="rounded-full transition-all duration-300 max-lg:h-2 max-lg:w-2 max-lg:bg-fg/20 max-lg:aria-[current]:w-6 max-lg:aria-[current]:bg-fg lg:px-2 lg:py-1 lg:text-[12.5px] lg:font-medium lg:text-fg/45 lg:hover:text-fg lg:aria-[current]:text-fg"
                  >
                    <span className="max-lg:sr-only">{p.step}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PanelCard({ p, n, on }: { p: Panel; n: number; on: boolean }) {
  return (
    <article
      aria-label={p.title}
      data-on={on || undefined}
      className="mk-dsx-card relative w-[86vw] max-w-[1180px] shrink-0 snap-start rounded-[28px] p-5 sm:w-[78vw] sm:p-7 lg:w-[min(1180px,calc(100vw-220px))] lg:p-9"
      style={{ "--tone": `var(--p-${p.tone})`, "--ink": `var(--p-${p.tone}-ink)` } as CSSProperties}
    >
      <div className="relative grid grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.6fr)] lg:gap-10">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.14em] text-[var(--ink)] uppercase">
            <span className="grid size-7 place-items-center rounded-full bg-white/80 text-[11.5px] tracking-normal tabular-nums shadow-sm">{String(n + 1).padStart(2, "0")}</span>
            {p.step}
          </p>
          <h3 className="mt-4 text-[clamp(1.35rem,2.1vw,1.95rem)] leading-[1.12] font-[420] tracking-[-0.03em]">{p.title}</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-fg/60">{p.body}</p>
          <ul className="mt-5 grid gap-2">
            {p.points.map((x) => (
              <li key={x} className="flex items-center gap-2.5 text-[14px] text-fg/75">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/80 text-[var(--ink)] shadow-sm">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {x}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative min-w-0 lg:pb-[3%]">
          <div className="mk-dsx-shot">
            <ShotFrame shot={p.shot} url={p.url} zoom={p.zoom} sizes="(min-width: 1024px) 760px, 86vw" />
          </div>
          {p.side && (
            <div className="mk-dsx-float absolute -bottom-5 -left-3 hidden w-[38%] rotate-[-2deg] sm:block lg:-left-8">
              <ShotFrame shot={p.side.shot} url={p.side.label} zoom={p.side.zoom} sizes="320px" />
            </div>
          )}
          {p.phone && (
            <div className="mk-dsx-float absolute -right-2 -bottom-7 hidden w-[22%] max-w-[170px] rotate-[3deg] sm:block lg:-right-6">
              <PhoneFrame src={p.phone} alt={`${p.title}, on a phone`} />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
