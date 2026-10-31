// The builder's clipboard: a copied section (or just its style) kept in this
// browser, so it can be pasted on another page or into another web app. What
// comes back is checked against the section schema before it's used.
import { newId, sectionSchema, sectionStyleSchema, type Section, type SiteDoc } from "@/lib/site/model";

const KEY = "cloudesk.builder.clipboard";

type Clip = { kind: "section"; section: Section; at: number } | { kind: "style"; style: Section["style"]; at: number };

export function copySection(section: Section) {
  write({ kind: "section", section: structuredClone(section), at: Date.now() });
}

export function copyStyle(style: Section["style"]) {
  write({ kind: "style", style: structuredClone(style), at: Date.now() });
}

function write(c: Clip) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Storage full or blocked: nothing to paste later.
  }
}

function read(): Clip | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Clip) : null;
  } catch {
    return null;
  }
}

/** What's on the clipboard, for enabling the paste buttons. */
export const clipKind = () => read()?.kind ?? null;

/** The copied section, ready to insert into `doc`: a new id, and detached from a global the site doesn't have. */
export function pasteSection(doc: SiteDoc): Section | null {
  const c = read();
  if (c?.kind !== "section") return null;
  const parsed = sectionSchema.safeParse(c.section);
  if (!parsed.success) return null;
  const s = { ...structuredClone(parsed.data), id: newId() } as Section;
  if (s.globalId && !(doc.globals ?? []).some((g) => g.id === s.globalId)) delete s.globalId;
  return s;
}

/** The copied style, checked. */
export function pasteStyle(): Section["style"] | null {
  const c = read();
  if (c?.kind !== "style") return null;
  const parsed = sectionStyleSchema.safeParse(c.style);
  return parsed.success ? (parsed.data as Section["style"]) : null;
}
