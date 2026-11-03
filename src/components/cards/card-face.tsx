// The business ID itself, in one of its designs: used by the public page and
// the editor's live preview. Plain markup (no hooks), so it renders on the
// server too. Its colours are its own, the same in light and dark mode.
import { Globe, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { BusinessCardData, BusinessCardStyle } from "@/db/schema";
import { initials, telHref, waHref } from "@/lib/cards/model";

type Props = { data: BusinessCardData; style: Required<BusinessCardStyle>; interactive?: boolean; qr?: string; className?: string };

/** A colour 0–1 of the way to white (for soft tints of the accent). */
function mix(hex: string, white: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * white));
  return `rgb(${c.join(",")})`;
}

export function CardFace({ data: d, style, interactive = false, qr, className }: Props) {
  const a = style.accent;
  const dark = style.design === "bold" || style.design === "night";
  const ink = dark ? "#ffffff" : "#16161a";
  const soft = dark ? "rgba(255,255,255,0.72)" : "#5b5b66";
  const line = dark ? "rgba(255,255,255,0.16)" : "rgba(22,22,26,0.08)";
  const bg: CSSProperties =
    style.design === "bold"
      ? { background: `linear-gradient(150deg, ${a}, ${mix(a, 0.25)} 60%, ${a})` }
      : style.design === "night"
        ? { background: `radial-gradient(120% 80% at 85% 0%, ${a}55, transparent 55%), #111116` }
        : { background: "#ffffff" };
  const wide = style.shape === "landscape";
  const rows: { href?: string; icon: ReactNode; text: string }[] = [];
  if (d.phone) rows.push({ href: telHref(d.phone), icon: <Phone size={15} strokeWidth={1.8} />, text: d.phone });
  if (d.whatsapp) rows.push({ href: waHref(d.whatsapp), icon: <MessageCircle size={15} strokeWidth={1.8} />, text: d.whatsapp === d.phone ? "WhatsApp" : d.whatsapp });
  if (d.email) rows.push({ href: `mailto:${d.email}`, icon: <Mail size={15} strokeWidth={1.8} />, text: d.email });
  if (d.website) rows.push({ href: d.website, icon: <Globe size={15} strokeWidth={1.8} />, text: d.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") });
  if (d.address) rows.push({ icon: <MapPin size={15} strokeWidth={1.8} />, text: d.address });

  const avatar = (
    <span
      aria-hidden
      style={{ width: wide ? 68 : 76, height: wide ? 68 : 76, borderRadius: 999, display: "grid", placeItems: "center", fontSize: wide ? 24 : 27, fontWeight: 600, letterSpacing: "0.02em", color: dark ? a : "#fff", background: dark ? "#ffffff" : a, boxShadow: style.design === "band" ? "0 0 0 5px #fff" : undefined, flex: "none" }}
    >
      {initials(d.name ?? "")}
    </span>
  );
  const who = (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 23, lineHeight: 1.15, fontWeight: 600, letterSpacing: "-0.01em", color: ink, overflowWrap: "anywhere" }}>{d.name || "Your name"}</div>
      {(d.title || d.department) && <div style={{ marginTop: 4, fontSize: 14, color: soft }}>{[d.title, d.department].filter(Boolean).join(" · ")}</div>}
      {d.company && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, fontWeight: 600, color: dark ? ink : a }}>
          {style.design === "classic" && <span style={{ width: 16, height: 3, borderRadius: 3, background: a }} />}
          {d.company}
        </div>
      )}
      {d.tagline && <div style={{ marginTop: 2, fontSize: 12.5, color: soft }}>{d.tagline}</div>}
    </div>
  );
  const contact = rows.length > 0 && (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
      {rows.map((r, k) => {
        const inner = (
          <>
            <span style={{ width: 30, height: 30, borderRadius: 10, display: "grid", placeItems: "center", flex: "none", color: dark ? ink : a, background: dark ? "rgba(255,255,255,0.12)" : mix(a, 0.88) }}>{r.icon}</span>
            <span style={{ minWidth: 0, overflowWrap: "anywhere", fontSize: 14, color: ink }}>{r.text}</span>
          </>
        );
        const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "5px 0", color: "inherit", textDecoration: "none" };
        return <li key={k}>{interactive && r.href ? <a href={r.href} target={r.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" style={rowStyle}>{inner}</a> : <div style={rowStyle}>{inner}</div>}</li>;
      })}
    </ul>
  );
  const links = (d.links ?? []).length > 0 && (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {(d.links ?? []).map((l, k) =>
        interactive ? (
          <a key={k} href={l.url} target="_blank" rel="noopener noreferrer" style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 500, textDecoration: "none", color: dark ? ink : a, boxShadow: `inset 0 0 0 1px ${dark ? "rgba(255,255,255,0.3)" : mix(a, 0.6)}` }}>
            {l.label}
          </a>
        ) : (
          <span key={k} style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 500, color: dark ? ink : a, boxShadow: `inset 0 0 0 1px ${dark ? "rgba(255,255,255,0.3)" : mix(a, 0.6)}` }}>{l.label}</span>
        ),
      )}
    </div>
  );
  const bio = d.bio && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: soft, whiteSpace: "pre-line" }}>{d.bio}</p>;

  return (
    <article
      className={className}
      style={{ ...bg, position: "relative", width: "100%", maxWidth: wide ? 620 : 380, borderRadius: 26, overflow: "hidden", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", boxShadow: dark ? "0 30px 60px -30px rgba(0,0,0,0.55)" : `0 0 0 1px ${line}, 0 30px 60px -34px rgba(0,0,0,0.3)`, color: ink }}
    >
      {style.design === "band" && <div style={{ height: wide ? 70 : 96, background: `linear-gradient(120deg, ${a}, ${mix(a, 0.35)})` }} />}
      <div style={{ padding: wide ? "26px 28px" : "26px 26px 24px", marginTop: style.design === "band" ? (wide ? -50 : -54) : 0, display: wide ? "grid" : "block", gridTemplateColumns: wide ? "1fr 1fr" : undefined, gap: wide ? 26 : undefined }}>
        <div>
          {style.design !== "minimal" && <div style={{ marginBottom: 16 }}>{avatar}</div>}
          {who}
          {bio && <div style={{ marginTop: 14 }}>{bio}</div>}
        </div>
        <div style={{ marginTop: wide ? 0 : 18, paddingTop: wide ? 0 : 16, borderTop: wide ? undefined : `1px solid ${line}`, display: "grid", gap: 14, alignContent: "start" }}>
          {contact}
          {links}
          {qr && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ display: "block", width: 84, height: 84, padding: 6, borderRadius: 12, background: "#fff", flex: "none" }} dangerouslySetInnerHTML={{ __html: qr.replace("<svg ", '<svg width="100%" height="100%" ') }} />
              <span style={{ fontSize: 12, color: soft }}>Scan to save this card</span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
