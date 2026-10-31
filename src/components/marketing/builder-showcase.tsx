"use client";

// The homepage's website-builder walkthrough: four steps on one side, and a
// mock builder on the other that plays each step. It autoplays while on
// screen, waits while hovered, and stays still for people who prefer reduced
// motion (the steps can still be clicked). The mock itself is decorative.
import clsx from "clsx";
import { Check, Globe, HelpCircle, Image as ImageIcon, LayoutGrid, Lock, Mail, MapPin, Monitor, MousePointer2, Palette, Rocket, ShoppingBag, Smartphone, Type, Wand2 } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FitBox } from "./interactive";

type V = CSSProperties & Record<`--${string}`, string>;

const STEPS = [
  { title: "Describe your business", line: "One sentence is all it takes.", icon: Wand2, tone: "lavender", ms: 5600 },
  { title: "Pick a look", line: "Templates styled to your brand.", icon: Palette, tone: "sky", ms: 4800 },
  { title: "Make it yours", line: "Drag in blocks. Click any text to edit.", icon: LayoutGrid, tone: "peach", ms: 5600 },
  { title: "Publish", line: "On your own domain, in one click.", icon: Rocket, tone: "mint", ms: 5400 },
] as const;

const ACCENT = "#b4532a";
const PRODUCTS = [
  ["Vanilla Smoke", "₹450", "var(--p-butter)"],
  ["Sea Salt", "₹520", "var(--p-sky)"],
  ["Monsoon", "₹480", "var(--p-mint)"],
  ["Jasmine", "₹450", "var(--p-rose)"],
] as const;
const BLOCKS = [
  [Type, "Text"],
  [ImageIcon, "Gallery"],
  [ShoppingBag, "Products"],
  [HelpCircle, "FAQ"],
  [Mail, "Contact form"],
  [MapPin, "Map"],
] as const;

const at = (ms: number) => ({ "--at": `${ms}ms` }) as V;

/** Skeleton → content, cross-faded at `ms` when `s` is 1 (0 = skeleton, 2 = content). */
function Fill({ s, ms = 1400, skeleton, children }: { s: 0 | 1 | 2; ms?: number; skeleton: ReactNode; children: ReactNode }) {
  if (s === 0) return <>{skeleton}</>;
  if (s === 2) return <>{children}</>;
  return (
    <span className="relative block">
      <span className="bs-out absolute inset-0" style={at(ms)}>{skeleton}</span>
      <span className="bs-in block" style={at(ms + 150)}>{children}</span>
    </span>
  );
}

const Bone = ({ w, h = 8, className }: { w: string; h?: number; className?: string }) => <span className={clsx("ob-shimmer block rounded-full", className)} style={{ width: w, height: h }} />;

function Candles() {
  return (
    <div className="flex h-full items-end justify-center gap-4 pb-7">
      {[74, 104, 60].map((h, i) => (
        <span key={i} className="relative w-10 rounded-t-[7px] rounded-b-[4px] bg-white/85 shadow-[0_10px_20px_-12px_rgb(0_0_0/0.35)]" style={{ height: h }}>
          <span className="absolute -top-1.5 left-[calc(50%-0.5px)] h-2 w-px bg-black/50" />
          <span className="bs-flame absolute -top-[22px] left-[calc(50%-6px)] h-[18px] w-3 rounded-[50%_50%_50%_50%/62%_62%_38%_38%]" style={{ background: "radial-gradient(circle at 50% 72%, #fffbe0 0 22%, #fbbf24 48%, #f97316 78%)", animationDelay: `${i * 0.35}s` }} />
          <span className="absolute inset-x-1.5 top-4 h-3 rounded-[3px]" style={{ background: `color-mix(in srgb, ${ACCENT} 18%, transparent)` }} />
        </span>
      ))}
    </div>
  );
}

/** The mock builder, drawn at 960×600 and scaled to fit. */
function Stage({ step, run }: { step: number; run: number }) {
  const fill: 0 | 1 | 2 = step === 0 ? 0 : step === 1 ? 1 : 2;
  const k = `${run}-${step}`;
  return (
    <FitBox width={960}>
      <div aria-hidden className="relative h-[600px] w-[960px] overflow-hidden rounded-[24px] select-none p-glass shadow-[0_40px_90px_-50px_rgb(60_40_110/0.45)]">
        {/* Toolbar */}
        <div className="flex h-[52px] items-center gap-3 border-b border-fg/[0.06] px-4">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="ml-2 text-[13px] font-semibold">Wick &amp; Wax</span>
          <span className="rounded-md bg-fg/[0.05] px-2 py-0.5 text-[11px] text-fg/55">Home</span>
          <div className="mx-auto grid text-[11.5px] font-medium [&>*]:col-start-1 [&>*]:row-start-1">
            {step === 3 ? (
              <>
                <span key={`d${k}`} className="bs-out flex items-center justify-center gap-1.5 rounded-full bg-fg/[0.05] px-3 py-1 text-fg/50" style={at(1000)}>Draft · not published</span>
                <span key={`u${k}`} className="bs-in flex items-center justify-center gap-1.5 rounded-full px-3 py-1" style={{ ...at(1100), background: "var(--p-mint)", color: "var(--p-mint-ink)" }}>
                  <Lock className="size-3" /> wickandwax.in
                </span>
              </>
            ) : (
              <span className="flex items-center justify-center gap-1.5 rounded-full bg-fg/[0.05] px-3 py-1 text-fg/50">Draft · not published</span>
            )}
          </div>
          <span className="flex rounded-full bg-fg/[0.05] p-0.5">
            <span className="grid h-6 w-8 place-items-center rounded-full bg-[var(--surface-solid)] shadow-sm"><Monitor className="size-3.5" /></span>
            <span className="grid h-6 w-8 place-items-center text-fg/45"><Smartphone className="size-3.5" /></span>
          </span>
          <span key={`p${k}`} className={clsx("relative grid h-8 min-w-[92px] place-items-center rounded-full bg-fg px-4 text-[12px] font-semibold text-bg [&>*]:col-start-1 [&>*]:row-start-1", step === 3 && "bs-press")} style={at(500)}>
            {step === 3 ? (
              <>
                <span className="bs-out" style={at(700)}>Publish</span>
                <span className="bs-in flex items-center gap-1.5" style={at(800)}><span className="size-1.5 rounded-full bg-[#4ade80]" /> Live</span>
                <span className="bs-ripple absolute inset-0 rounded-full ring-2 ring-fg/40" style={at(500)} />
              </>
            ) : (
              "Publish"
            )}
          </span>
        </div>

        <div className="flex h-[548px]">
          {/* Blocks rail, shown while making it yours */}
          <div className={clsx("shrink-0 overflow-hidden border-fg/[0.06] transition-[width,opacity] duration-700 ease-[cubic-bezier(.16,1,.3,1)]", step === 2 ? "w-[180px] border-r opacity-100" : "w-0 opacity-0")}>
            <div className="w-[180px] p-3">
              <p className="mb-2 h-5 px-1 text-[11px] font-semibold tracking-wider text-fg/45 uppercase">Add a block</p>
              <div className="grid gap-1.5">
                {BLOCKS.map(([Icon, name]) => (
                  <span key={name} className={clsx("flex h-[34px] items-center gap-2 rounded-[10px] px-2.5 text-[12px] font-medium", name === "Gallery" ? "bg-[var(--p-peach)] text-[var(--p-peach-ink)]" : "bg-fg/[0.03] text-fg/70")}>
                    <Icon className="size-3.5" /> {name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div className="relative flex-1 overflow-hidden p-6" style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--fg) 9%, transparent) 1px, transparent 1.2px) 0 0 / 18px 18px" }}>
            <div className={clsx("mx-auto flex h-full max-w-[700px] flex-col overflow-hidden rounded-[16px] bg-[var(--surface-solid)] shadow-[0_20px_50px_-30px_rgb(0_0_0/0.35)] ring-1 ring-fg/[0.06] transition-[opacity,filter] duration-700", step === 0 ? "opacity-55 blur-[1.5px]" : "opacity-100")}>
              {/* Site nav */}
              <div className="flex h-11 shrink-0 items-center gap-3 border-b border-fg/[0.05] px-5">
                <Fill s={fill} skeleton={<Bone w="90px" h={10} />}>
                  <span className="flex items-center gap-2 text-[13px] font-semibold"><span className="size-5 rounded-full" style={{ background: ACCENT }} /> Wick &amp; Wax</span>
                </Fill>
                <span className="ml-auto flex items-center gap-4 text-[11px] text-fg/55">
                  <Fill s={fill} skeleton={<span className="flex gap-3"><Bone w="34px" /><Bone w="34px" /><Bone w="34px" /></span>}>
                    <span className="flex gap-4"><span>Shop</span><span>Markets</span><span>About</span></span>
                  </Fill>
                  <ShoppingBag className="size-3.5" />
                </span>
              </div>
              {/* Hero */}
              <div className="grid h-[196px] shrink-0 grid-cols-[1.1fr_1fr] items-center gap-6 px-5">
                <div className="grid gap-3">
                  <div className="relative">
                    <Fill s={fill} skeleton={<span className="grid gap-2"><Bone w="92%" h={18} /><Bone w="70%" h={18} /></span>}>
                      <p className="text-[25px] leading-[1.08] font-semibold tracking-[-0.03em]">Small-batch candles, poured by hand in Goa</p>
                    </Fill>
                    {step === 2 && (
                      <span key={`h${k}`} className="bs-in pointer-events-none absolute -inset-2 rounded-[10px] border-2 border-dashed border-[var(--p-lavender-ink)]/70" style={at(3000)}>
                        <span className="absolute -top-2.5 left-2 rounded-full bg-[var(--p-lavender-ink)] px-2 text-[9px] leading-[18px] font-semibold text-white">Heading</span>
                      </span>
                    )}
                  </div>
                  <Fill s={fill} skeleton={<Bone w="80%" />}>
                    <p className="text-[12px] text-fg/55">Soy wax, cotton wicks, scents of the coast.</p>
                  </Fill>
                  <Fill s={fill} skeleton={<Bone w="110px" h={30} />}>
                    <span className="inline-flex h-[30px] w-fit items-center rounded-full px-4 text-[11.5px] font-semibold text-white" style={{ background: ACCENT }}>Shop candles</span>
                  </Fill>
                </div>
                <div className="h-[156px] overflow-hidden rounded-[14px]">
                  <Fill s={fill} skeleton={<span className="ob-shimmer block h-[156px] rounded-[14px]" />}>
                    <div className="h-[156px]" style={{ background: "linear-gradient(150deg, var(--p-peach), var(--p-butter) 60%, var(--p-rose))" }}><Candles /></div>
                  </Fill>
                </div>
              </div>
              {/* Gallery, dragged in while making it yours */}
              {step >= 2 && (
                <div key={`g${run}`} className={clsx("shrink-0 px-5", step === 2 && "bs-grow")} style={at(2300)}>
                  <div className={clsx("grid h-[64px] grid-cols-5 gap-2 rounded-[12px] p-1.5", step === 2 && "ring-2 ring-[var(--p-peach-ink)]/35")}>
                    {["var(--p-peach)", "var(--p-butter)", "var(--p-rose)", "var(--p-sky)", "var(--p-mint)"].map((c) => (
                      <span key={c} className="rounded-[8px]" style={{ background: `linear-gradient(140deg, ${c}, color-mix(in srgb, ${c} 50%, var(--surface-solid)))` }} />
                    ))}
                  </div>
                </div>
              )}
              {/* Products */}
              <div className="mt-4 shrink-0 px-5">
                <Fill s={fill} skeleton={<Bone w="120px" h={10} />}>
                  <p className="text-[13px] font-semibold">Bestsellers</p>
                </Fill>
                <div className="mt-3 grid grid-cols-4 gap-3">
                  {PRODUCTS.map(([name, price, c], i) => (
                    <div key={name} className="grid gap-1.5">
                      <Fill s={fill} ms={1500 + i * 90} skeleton={<span className="ob-shimmer block aspect-[4/3] rounded-[10px]" />}>
                        <span className="grid aspect-[4/3] place-items-end justify-center rounded-[10px] pb-2" style={{ background: c }}>
                          <span className="h-9 w-7 rounded-t-[5px] rounded-b-[3px] bg-white/85" />
                        </span>
                      </Fill>
                      <Fill s={fill} ms={1500 + i * 90} skeleton={<Bone w="70%" />}>
                        <span className="flex justify-between text-[11px]"><span className="font-medium">{name}</span><span className="text-fg/55">{price}</span></span>
                      </Fill>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Step overlays ── */}
        {step === 0 && (
          <div key={k} className="absolute inset-x-0 top-[132px] flex justify-center">
            <div className="bs-in w-[580px] rounded-[20px] bg-[var(--surface-solid)] p-5 shadow-[0_30px_70px_-30px_rgb(60_40_110/0.5)] ring-1 ring-fg/[0.06]" style={at(100)}>
              <p className="flex items-center gap-2 text-[11.5px] font-medium text-fg/50"><Wand2 className="size-3.5 text-[var(--p-lavender-ink)]" /> Tell us about your business</p>
              <p className="mt-2 text-[19px] leading-snug font-medium tracking-[-0.01em]">
                <span className="inline-block whitespace-nowrap" style={{ animation: "ob-type 2s steps(58, end) 0.4s both" }}>Hand-poured candles from Goa — online and at weekend markets</span>
              </p>
              <div className="mt-4 flex gap-2">
                {[
                  ["Candle store", "peach"],
                  ["Sells at markets", "mint"],
                  ["UPI & cash on delivery", "sky"],
                ].map(([c, tone], i) => (
                  <span key={c} className="ob-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-semibold" style={{ animationDelay: `${2600 + i * 180}ms`, background: `var(--p-${tone})`, color: `var(--p-${tone}-ink)` }}>
                    <Check className="size-3" strokeWidth={3} /> {c}
                  </span>
                ))}
              </div>
              <div className="bs-in mt-5 flex items-center gap-3" style={at(3400)}>
                <span className="text-[11.5px] font-medium text-fg/55">Building your site</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/[0.08]">
                  <span className="block h-full rounded-full bg-gradient-to-r from-[var(--p-lavender-ink)] via-[var(--p-sky-ink)] to-[var(--p-mint-ink)]" style={{ transformOrigin: "left", animation: "ob-grow 1.6s cubic-bezier(.65,0,.35,1) 3.5s both" }} />
                </span>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div key={k} className="bs-in absolute right-6 bottom-6 w-[330px] rounded-[18px] bg-[var(--surface-solid)] p-4 shadow-[0_30px_70px_-30px_rgb(60_40_110/0.5)] ring-1 ring-fg/[0.06]" style={at(100)}>
            <p className="text-[12px] font-semibold">Choose a look</p>
            <div className="relative mt-3 grid grid-cols-3 gap-2.5">
              {[
                ["Soft", "linear-gradient(150deg, var(--p-peach), var(--p-butter))"],
                ["Bold", "linear-gradient(150deg, var(--p-lavender), var(--p-sky))"],
                ["Fresh", "linear-gradient(150deg, var(--p-mint), var(--p-sky))"],
              ].map(([name, bg], i) => (
                <div key={name} className="grid gap-1.5">
                  <span className="relative grid aspect-[4/5] content-start gap-1 rounded-[10px] p-2" style={{ background: bg }}>
                    <span className="block h-1.5 w-2/3 rounded-full bg-white/80" />
                    <span className="block h-1.5 w-1/2 rounded-full bg-white/60" />
                    <span className="mt-auto grid grid-cols-2 gap-1"><span className="aspect-square rounded-[4px] bg-white/70" /><span className="aspect-square rounded-[4px] bg-white/70" /></span>
                    {i === 0 && <span className="bs-in absolute -inset-1 rounded-[13px] ring-2 ring-[var(--p-peach-ink)]" style={at(1300)} />}
                  </span>
                  <span className="text-center text-[10.5px] font-medium text-fg/60">{name}</span>
                </div>
              ))}
              <span className="bs-ripple pointer-events-none absolute top-[38px] left-[34px] size-6 rounded-full bg-[var(--p-peach-ink)]/40" style={at(1200)} />
              <MousePointer2 className="bs-move pointer-events-none absolute top-0 left-0 size-5 fill-fg text-bg" style={{ "--fx": "250px", "--fy": "150px", "--tx": "44px", "--ty": "48px", ...at(200) } as V} />
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-fg/[0.06] pt-3">
              <span className="text-[10.5px] font-medium text-fg/55">Colours from your logo</span>
              <span className="ml-auto flex gap-1">
                {[ACCENT, "#f2c38b", "#2f2a26", "#f7efe6"].map((c) => <span key={c} className="size-4 rounded-full ring-1 ring-fg/10" style={{ background: c }} />)}
              </span>
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <div key={`drag${k}`} className="bs-drag pointer-events-none absolute top-0 left-0 z-20" style={{ "--fx": "12px", "--fy": "116px", "--tx": "330px", "--ty": "318px", ...at(700) } as V}>
              <span className="flex h-[34px] w-[156px] items-center gap-2 rounded-[10px] bg-[var(--p-peach)] px-2.5 text-[12px] font-medium text-[var(--p-peach-ink)] shadow-[0_18px_30px_-12px_rgb(0_0_0/0.35)] ring-1 ring-[var(--p-peach-ink)]/30">
                <ImageIcon className="size-3.5" /> Gallery
              </span>
              <MousePointer2 className="absolute -right-2 -bottom-3 size-5 fill-fg text-bg" />
            </div>
            <div key={`ins${k}`} className="bs-in absolute top-[78px] right-5 w-[196px] rounded-[16px] bg-[var(--surface-solid)] p-3.5 text-[11px] shadow-[0_30px_70px_-30px_rgb(60_40_110/0.5)] ring-1 ring-fg/[0.06]" style={at(3100)}>
              <p className="font-semibold">Heading</p>
              <div className="mt-2.5 flex items-center justify-between text-fg/60"><span>Font</span><span className="font-medium text-fg">Fraunces</span></div>
              <div className="mt-2 flex items-center justify-between text-fg/60"><span>Size</span><span className="font-medium text-fg">42px</span></div>
              <div className="mt-1.5 h-1 rounded-full bg-fg/10"><span className="block h-full w-2/3 rounded-full bg-fg/70" /></div>
              <div className="mt-2.5 flex gap-1.5">
                {[ACCENT, "#2f2a26", "#4f46e5", "#0f766e"].map((c, i) => <span key={c} className={clsx("size-5 rounded-full", i === 1 && "ring-2 ring-fg/50 ring-offset-1 ring-offset-[var(--surface-solid)]")} style={{ background: c }} />)}
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div key={`ph${k}`} className="bs-in absolute bottom-6 left-7 w-[150px] rounded-[26px] bg-fg p-[6px] shadow-[0_30px_60px_-24px_rgb(0_0_0/0.5)]" style={at(900)}>
              <div className="h-[276px] overflow-hidden rounded-[21px] bg-[var(--surface-solid)]">
                <div className="flex items-center justify-between px-3 pt-3 text-[9px] font-semibold">
                  <span className="flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: ACCENT }} /> Wick &amp; Wax</span>
                  <ShoppingBag className="size-2.5" />
                </div>
                <p className="px-3 pt-2.5 text-[13px] leading-[1.1] font-semibold tracking-tight">Small-batch candles, poured by hand</p>
                <span className="mx-3 mt-2 inline-flex h-5 items-center rounded-full px-2.5 text-[8px] font-semibold text-white" style={{ background: ACCENT }}>Shop candles</span>
                <div className="mx-3 mt-2.5 h-[86px] overflow-hidden rounded-[10px]" style={{ background: "linear-gradient(150deg, var(--p-peach), var(--p-butter))" }}>
                  <div className="origin-top scale-[0.55]"><div className="h-[150px]"><Candles /></div></div>
                </div>
                <div className="mx-3 mt-2 grid grid-cols-2 gap-1.5">
                  {PRODUCTS.slice(0, 2).map(([n, , c]) => <span key={n} className="aspect-square rounded-[7px]" style={{ background: c }} />)}
                </div>
              </div>
            </div>
            <div key={`live${k}`} className="absolute right-6 bottom-6 w-[290px]">
              <div className="bs-in relative rounded-[18px] bg-[var(--surface-solid)] p-4 shadow-[0_30px_70px_-30px_rgb(60_40_110/0.5)] ring-1 ring-fg/[0.06]" style={at(1300)}>
                <p className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
                  <span className="grid size-7 place-items-center rounded-full bg-[var(--p-mint)] text-[var(--p-mint-ink)]"><Globe className="size-3.5" /></span>
                  You&apos;re live
                </p>
                <ul className="mt-3 grid gap-2 text-[12px]">
                  {["Connected to your own domain", "UPI & cash-on-delivery checkout", "Looks right on every phone", "Search basics set up"].map((t, i) => (
                    <li key={t} className="bs-in flex items-center gap-2" style={at(1700 + i * 220)}>
                      <span className="grid size-4 place-items-center rounded-full bg-fg text-bg"><Check className="size-2.5" strokeWidth={3.5} /></span>
                      {t}
                    </li>
                  ))}
                </ul>
                {Array.from({ length: 14 }, (_, i) => {
                  const a = (i / 14) * Math.PI * 2;
                  const tones = ["peach", "mint", "sky", "lavender", "butter", "rose"];
                  return (
                    <span
                      key={i}
                      className="pointer-events-none absolute top-6 left-1/2 size-2 rounded-[2px]"
                      style={{ background: `var(--p-${tones[i % 6]}-ink)`, "--x": `${Math.round(Math.cos(a) * 130)}px`, "--y": `${Math.round(Math.sin(a) * 90 - 40)}px`, "--r": `${i * 47}deg`, animation: "lx-confetti 1.3s cubic-bezier(.2,.8,.2,1) 1.4s both" } as V}
                    />
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </FitBox>
  );
}

export function BuilderShowcase() {
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [hover, setHover] = useState(false);
  const [inView, setInView] = useState(false);
  const [still, setStill] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const picked = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return () => mq.removeEventListener("change", sync);
    let seen = false;
    const io = new IntersectionObserver(
      ([e]) => {
        setInView(e.isIntersecting);
        // Start the story from the top the first time it's actually seen.
        if (e.isIntersecting && !seen) {
          seen = true;
          if (picked.current) return;
          setStep(0);
          setRun((r) => r + 1);
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      mq.removeEventListener("change", sync);
    };
  }, []);

  const go = (i: number, byHand = false) => {
    if (byHand) picked.current = true;
    setStep(i);
    setRun((r) => r + 1);
  };
  const paused = hover || !inView || still;

  return (
    <div ref={ref} className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <ol className="order-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:order-1 lg:grid-cols-1">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = i === step;
          return (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => go(i, true)}
                aria-current={active ? "step" : undefined}
                className={clsx("group relative w-full overflow-hidden rounded-[22px] p-4 text-left transition-all duration-500 sm:p-5", active ? "bg-[var(--surface-solid)] shadow-[0_24px_50px_-30px_rgb(60_40_110/0.45)] ring-1 ring-fg/[0.06]" : "hover:bg-[var(--surface-solid)]/60", `tint-${s.tone}`)}
              >
                <span className="flex items-center gap-4">
                  <span className={clsx("grid size-11 shrink-0 place-items-center rounded-[14px] transition-all duration-500", active ? "tint-chip scale-100" : "scale-95 bg-fg/[0.04] text-fg/45")}>
                    {i < step ? <Check className="size-4.5" strokeWidth={2.5} /> : <Icon className="size-[18px]" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className={clsx("text-[12px] font-semibold tabular-nums", active ? "tint-ink" : "text-fg/35")}>0{i + 1}</span>
                      <span className={clsx("text-[18px] font-medium tracking-[-0.02em] transition-colors", active ? "text-fg" : "text-fg/55")}>{s.title}</span>
                    </span>
                    <span className={clsx("block overflow-hidden text-[14px] text-fg/55 transition-all duration-500", active ? "mt-1 max-h-16 opacity-100" : "max-h-0 opacity-0")}>{s.line}</span>
                  </span>
                </span>
                {active && (
                  <span className="absolute inset-x-5 bottom-0 h-[3px] overflow-hidden rounded-full bg-fg/[0.06]">
                    <span
                      key={run}
                      className="bs-progress block h-full rounded-full"
                      style={{ "--bs-dur": `${s.ms}ms`, background: "var(--t-ink)", animationPlayState: paused ? "paused" : "running", transform: still ? "none" : undefined } as V}
                      onAnimationEnd={() => {
                        if (!still) go((step + 1) % STEPS.length);
                      }}
                    />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="relative order-1 lg:order-2">
        <div aria-hidden className="pointer-events-none absolute -inset-4 rounded-[44px] sm:-inset-8" style={{ background: "radial-gradient(60% 70% at 15% 20%, color-mix(in srgb, var(--tint-lavender) 90%, transparent), transparent 70%), radial-gradient(55% 65% at 90% 85%, color-mix(in srgb, var(--tint-peach) 85%, transparent), transparent 70%), radial-gradient(40% 50% at 85% 10%, color-mix(in srgb, var(--tint-sky) 80%, transparent), transparent 70%)" }} />
        <div className="relative">
          <Stage step={step} run={run} />
        </div>
      </div>
    </div>
  );
}
