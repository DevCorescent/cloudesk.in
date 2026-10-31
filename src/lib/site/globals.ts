// Global components: a section saved once and placed on many pages. Every
// instance carries the same globalId; editing one copies its content and
// design to the others, so rendering and publishing need no special cases.
import type { Section, SiteDoc } from "./model";

export const MAX_GLOBALS = 50;

const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
export const newGlobalId = () => `g_${rand(10)}`;
const newSectionId = () => `s_${rand(10)}`;

export function instancesOf(doc: SiteDoc, globalId: string) {
  return doc.pages.flatMap((p) => p.sections.filter((s) => s.globalId === globalId).map((s) => ({ page: p, section: s })));
}

/** The shared parts of a section (everything except its own id and A/B test). */
function shared(s: Section) {
  return { type: s.type, variant: s.variant, props: structuredClone(s.props), style: structuredClone(s.style) };
}

/** Copies one instance's content and design to every other instance. Mutates `doc`. */
export function syncGlobal(doc: SiteDoc, from: Section) {
  if (!from.globalId) return 0;
  let n = 0;
  for (const { section } of instancesOf(doc, from.globalId)) {
    if (section === from || section.id === from.id) continue;
    Object.assign(section, shared(from));
    n++;
  }
  return n;
}

/** Turns a section into the first instance of a new global component. */
export function makeGlobal(doc: SiteDoc, section: Section, name: string) {
  if ((doc.globals?.length ?? 0) >= MAX_GLOBALS) throw new Error(`A site can have up to ${MAX_GLOBALS} global components`);
  const id = newGlobalId();
  doc.globals = [...(doc.globals ?? []), { id, name: name.trim().slice(0, 60) || "Component" }];
  section.globalId = id;
  return id;
}

/** A new instance of a global component, ready to insert into a page. */
export function instantiate(doc: SiteDoc, globalId: string): Section | null {
  const src = instancesOf(doc, globalId)[0]?.section;
  if (!src) return null;
  return { id: newSectionId(), ...shared(src), globalId } as Section;
}

/** This instance becomes an ordinary section; the others stay linked. */
export function detach(section: Section) {
  delete section.globalId;
}

/** Removes a global component: its instances stay on their pages as ordinary sections. */
export function unlinkGlobal(doc: SiteDoc, globalId: string) {
  for (const { section } of instancesOf(doc, globalId)) delete section.globalId;
  doc.globals = (doc.globals ?? []).filter((g) => g.id !== globalId);
}

/** Instances whose content no longer matches the first (e.g. after an edit outside the builder). */
export function outOfSync(doc: SiteDoc) {
  const out: { globalId: string; name: string; pages: string[] }[] = [];
  for (const g of doc.globals ?? []) {
    const list = instancesOf(doc, g.id);
    if (list.length < 2) continue;
    const ref = JSON.stringify(shared(list[0].section));
    const differ = list.filter((x) => JSON.stringify(shared(x.section)) !== ref);
    if (differ.length) out.push({ globalId: g.id, name: g.name, pages: differ.map((x) => x.page.path) });
  }
  return out;
}
