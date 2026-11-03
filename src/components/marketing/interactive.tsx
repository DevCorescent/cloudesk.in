"use client";

// The moving parts of the marketing site: scroll reveals, keyword highlights,
// and scene scaling. (The header lives in site-header.tsx.)
import clsx from "clsx";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Rises into view once, when scrolled to. */
export function Reveal({ children, delay = 0, className, as: Tag = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "li" }) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setIn(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} data-in={inView || undefined} className={clsx("mk-reveal", className)} style={{ "--d": `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}

/** A keyword in a heading that gets highlighted (or underlined) when it comes into view. */
export function Mark({ children, tone = "lavender", kind = "highlight", delay = 250 }: { children: ReactNode; tone?: "lavender" | "peach" | "mint" | "sky" | "butter" | "rose"; kind?: "highlight" | "underline"; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  if (kind === "underline")
    return (
      <span ref={ref} data-on={on || undefined} className="mk-underline" style={{ "--d": `${delay}ms` } as CSSProperties}>
        {children}
        <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden>
          <path d="M2 8 C 40 3, 80 3, 110 6 S 170 10, 198 4" fill="none" stroke={`var(--p-${tone}-ink)`} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </span>
    );
  return (
    <span ref={ref} data-on={on || undefined} className="mk-mark" style={{ "--mk-c": `var(--p-${tone})`, "--d": `${delay}ms` } as CSSProperties}>
      {children}
    </span>
  );
}

/**
 * Draws a scene at its design width and scales the whole thing to fit, so
 * nothing crowds on phones (text inside scenes has fixed sizes).
 */
export function FitBox({ width = 560, className, children }: { width?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [z, setZ] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setZ(Math.min(1, e.contentRect.width / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={ref} className={clsx("mx-auto w-full", className)} style={{ maxWidth: width }}>
      <div style={z === null ? undefined : { width, zoom: z }}>{children}</div>
    </div>
  );
}

/** Marks a heading's content; one-line fitting is done for every heading by OneLineHeadings. */
export function FitLine({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * A heading whose words rise into place one after another (softly, from a
 * blur) when it comes into view. Pass plain text, or parts with their own
 * class (e.g. a gradient). The text stays one readable string for screen
 * readers and search.
 */
export function RiseWords({ parts, delay = 0, className }: { parts: (string | { text: string; className?: string })[]; delay?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [inView, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const f = requestAnimationFrame(() => setIn(true));
      return () => cancelAnimationFrame(f);
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setIn(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  let i = 0;
  return (
    <span ref={ref} data-in={inView || undefined} className={clsx("mk-words", className)} style={{ "--d": `${delay}ms` } as CSSProperties}>
      {parts.map((p, pi) => {
        const text = typeof p === "string" ? p : p.text;
        const cls = typeof p === "string" ? undefined : p.className;
        // A styled part (a gradient phrase) rises as one piece, so its styling stays continuous.
        const words = cls ? [text] : text.split(/(\s+)/);
        return words.map((w, wi) =>
          /^\s+$/.test(w) || !w ? (
            w
          ) : (
            <span key={`${pi}-${wi}`} className={clsx("mk-word", cls)} style={{ "--i": i++ } as CSSProperties}>
              {w}
            </span>
          ),
        );
      })}
    </span>
  );
}

/**
 * One word in a headline that cycles through `words` (“Run your whole
 * business. / store. / website.”): each slides up out of a soft blur, and the
 * gap it sits in resizes to fit, so the line around it never jumps. A thin
 * underline takes each word's own colour. Still (the first word) for reduced motion.
 */
export function WordCycle({ words, every = 2200, delay = 0 }: { words: { text: string; tone: string }[]; every?: number; delay?: number }) {
  const [at, setAt] = useState(0);
  const [w, setW] = useState<number[]>([]);
  const measure = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = measure.current;
    if (!el) return;
    // Zero while the page is hidden (the phone intro); the box then just takes the word's own width.
    const read = () => setW(Array.from(el.children).map((c) => (c as HTMLElement).offsetWidth));
    read();
    // Fonts arriving (and the headline resizing) change the widths.
    const ro = new ResizeObserver(read);
    ro.observe(el);
    void document.fonts?.ready.then(read);
    return () => ro.disconnect();
  }, [words]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let t: ReturnType<typeof setTimeout>;
    const start = setTimeout(function tick() {
      setAt((a) => (a + 1) % words.length);
      t = setTimeout(tick, every);
    }, every + delay);
    return () => {
      clearTimeout(start);
      clearTimeout(t);
    };
  }, [words.length, every, delay]);
  return (
    <span className="mk-cycle" style={{ width: w[at] ? `${w[at]}px` : "auto", "--tone": words[at]!.tone } as CSSProperties}>
      {/* The words, laid out unseen, to measure each one's width. */}
      <span ref={measure} aria-hidden className="mk-cycle-measure">{words.map((x) => <span key={x.text}>{x.text}</span>)}</span>
      <span className="sr-only">{words[0]!.text}</span>
      {words.map((x, i) => <span key={x.text} aria-hidden className="mk-cycle-word" data-on={i === at || undefined} data-gone={i === (at - 1 + words.length) % words.length || undefined}>{x.text}</span>)}
    </span>
  );
}
