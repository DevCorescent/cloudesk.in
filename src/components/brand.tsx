import Link from "next/link";

// The Cloudesk mark: the "d" of the wordmark drawn as a cloud — a red stem
// and crown, an amber right side and a dark base. The base uses the text
// colour, so it reads in light and dark themes alike.
const RED = "#FF5A5F";
const AMBER = "#FDBA5A";

function CloudD({ className, style, title }: { className?: string; style?: React.CSSProperties; title?: string }) {
  return (
    <svg viewBox="14 9 292 459" className={className} style={style} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} fill="none" strokeWidth="28" strokeLinecap="butt">
      <path d="M28 387V90A67 67 0 0 1 95 23" stroke={RED} />
      <path d="M95 23A67 67 0 0 1 161 102A100 100 0 0 1 238 282" stroke={AMBER} />
      <path d="M238 282A72 72 0 0 1 162 398A67 67 0 0 1 28 387" stroke="currentColor" strokeOpacity=".72" />
    </svg>
  );
}

/** The mark on its own (sidebar, favicon-sized places). */
export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center text-fg ${className}`} aria-hidden>
      <CloudD className="h-full w-auto" />
    </span>
  );
}

/** The full "cloudesk" wordmark; size it with font-size (text-[22px] etc.). */
export function Wordmark({ className = "text-[22px]" }: { className?: string }) {
  return (
    <span className={`inline-block py-[0.12em] leading-none font-medium tracking-[-0.025em] whitespace-nowrap text-fg ${className}`} aria-label="Cloudesk" role="img">
      <span aria-hidden>clou</span>
      <CloudD className="inline-block" style={{ height: "1.1em", width: "0.7em", verticalAlign: "-0.17em", margin: "0 0.01em 0 0.03em" }} />
      <span aria-hidden>esk</span>
    </span>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} aria-label="Cloudesk home" className="inline-flex items-center">
      <Wordmark className="text-[22px]" />
    </Link>
  );
}
