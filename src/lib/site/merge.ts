// Three-way merge of site documents, used by version branches.
//
// base   = the document when the branch was made
// main   = the live working copy now
// branch = the branch now
//
// Whatever only one side changed is taken from that side. Objects (theme,
// section props and style, page fields) merge key by key, so a headline edited
// on main and a colour changed on the branch combine cleanly. Lists such as a
// section's items are compared as a whole. When both sides changed the same
// thing differently, that is a conflict for a person to decide.
import { sectionDef, type Page, type Section, type SiteDoc } from "./model";

export type Side = "main" | "branch";
export type MergeConflict = { id: string; label: string; pageId?: string; sectionId?: string; main: unknown; branch: unknown; resolution: Side | null };
export type MergeResult = { doc: SiteDoc; conflicts: MergeConflict[]; fromBranch: number; fromMain: number };

const ABSENT = Symbol("absent");
type V = unknown;

/** Key-order-independent JSON, so reformatting never counts as a change. */
function canon(v: V): string {
  if (v === undefined || v === ABSENT) return "∅";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, V>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, V>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}
const same = (a: V, b: V) => canon(a) === canon(b);
const isObj = (v: V): v is Record<string, V> => !!v && typeof v === "object" && !Array.isArray(v);
const present = (v: V) => v !== undefined && v !== ABSENT;

type Ctx = { resolutions: Record<string, Side>; conflicts: MergeConflict[]; fromBranch: number; fromMain: number };
type Where = { label: string; pageId?: string; sectionId?: string };

/** Merges one value; objects recurse key by key. Returns ABSENT for "remove". */
function mergeValue(ctx: Ctx, id: string, where: Where, b: V, m: V, t: V): V {
  if (same(m, t)) return m;
  if (same(b, m)) {
    ctx.fromBranch++;
    return t;
  }
  if (same(b, t)) {
    ctx.fromMain++;
    return m;
  }
  if (isObj(m) && isObj(t) && (isObj(b) || !present(b))) {
    const bo = isObj(b) ? b : {};
    const out: Record<string, V> = {};
    const own = (o: Record<string, V>, k: string) => (Object.hasOwn(o, k) ? o[k] : ABSENT);
    for (const k of new Set([...Object.keys(m), ...Object.keys(t), ...Object.keys(bo)])) {
      // Parsed JSON can carry a "__proto__" own key; assigning it would re-prototype `out`.
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      // "props" is an implementation detail; "Hero › heading" reads better.
      const v = mergeValue(ctx, `${id}.${k}`, { ...where, label: k === "props" ? where.label : `${where.label} › ${k}` }, own(bo, k), own(m, k), own(t, k));
      if (present(v)) out[k] = v;
    }
    return out;
  }
  const resolution = ctx.resolutions[id] ?? null;
  ctx.conflicts.push({ id, ...where, main: present(m) ? m : null, branch: present(t) ? t : null, resolution });
  return resolution === "branch" ? t : m;
}

/**
 * Merges the order of a list of ids. The side that reordered wins; when both
 * did, it is a conflict. Items one side added go after their neighbour.
 */
function mergeOrder(ctx: Ctx, id: string, where: Where, base: string[], main: string[], branch: string[], keep: Set<string>): string[] {
  const shared = new Set(base.filter((x) => main.includes(x) && branch.includes(x)));
  const rel = (list: string[]) => list.filter((x) => shared.has(x));
  const [rb, rm, rt] = [rel(base), rel(main), rel(branch)];
  let useBranch = !same(rb, rt) && same(rb, rm);
  if (!same(rb, rm) && !same(rb, rt) && !same(rm, rt)) {
    const resolution = ctx.resolutions[id] ?? null;
    ctx.conflicts.push({ id, ...where, main: rm, branch: rt, resolution });
    useBranch = resolution === "branch";
  }
  const [primary, secondary] = useBranch ? [branch, main] : [main, branch];
  const out = primary.filter((x) => keep.has(x));
  secondary.forEach((x, i) => {
    if (!keep.has(x) || out.includes(x)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = out.indexOf(secondary[j]);
      if (p >= 0) {
        at = p + 1;
        break;
      }
    }
    out.splice(at, 0, x);
  });
  return out;
}

/** Merges a keyed list (pages or sections): adds, deletes, edits and order. */
function mergeList<T extends { id: string }>(
  ctx: Ctx,
  id: string,
  where: Where,
  base: T[],
  main: T[],
  branch: T[],
  describe: (item: T) => Where,
  mergeItem: (b: T, m: T, t: T) => T,
): T[] {
  const [bm, mm, tm] = [base, main, branch].map((l) => new Map(l.map((x) => [x.id, x])));
  const result = new Map<string, T>();
  for (const key of new Set([...bm.keys(), ...mm.keys(), ...tm.keys()])) {
    const [b, m, t] = [bm.get(key), mm.get(key), tm.get(key)];
    if (!b) {
      // Added on one side (or, rarely, the same id added on both).
      if (m && t && !same(m, t)) result.set(key, mergeValue(ctx, `${id}:${key}`, describe(m), ABSENT, m, t) as T);
      else if (m || t) {
        if (!m) ctx.fromBranch++;
        result.set(key, (m ?? t)!);
      }
      continue;
    }
    if (m && t) {
      result.set(key, mergeItem(b, m, t));
      continue;
    }
    if (!m && !t) continue;
    // Deleted on one side. Fine if the other side left it alone.
    const kept = (m ?? t)!;
    if (same(b, kept)) {
      if (!t) ctx.fromBranch++;
      continue;
    }
    const resolution = ctx.resolutions[`${id}:${key}`] ?? null;
    const d = describe(kept);
    ctx.conflicts.push({ id: `${id}:${key}`, ...d, label: `${d.label} (${m ? "deleted on the branch, edited on main" : "deleted on main, edited on the branch"})`, main: m ?? null, branch: t ?? null, resolution });
    const keepIt = resolution === "branch" ? !!t : !!m;
    if (keepIt) result.set(key, kept);
  }
  const order = mergeOrder(ctx, `${id}:order`, { ...where, label: `${where.label} order` }, base.map((x) => x.id), main.map((x) => x.id), branch.map((x) => x.id), new Set(result.keys()));
  return order.map((k) => result.get(k)!);
}

export function mergeDocs(base: SiteDoc, main: SiteDoc, branch: SiteDoc, resolutions: Record<string, Side> = {}): MergeResult {
  const ctx: Ctx = { resolutions, conflicts: [], fromBranch: 0, fromMain: 0 };
  const { pages: bp, ...bRest } = base;
  const { pages: mp, ...mRest } = main;
  const { pages: tp, ...tRest } = branch;
  const site = mergeValue(ctx, "site", { label: "Site settings" }, bRest, mRest, tRest) as Omit<SiteDoc, "pages">;

  const pageTitle = (p: Page) => `"${p.title}" (${p.path})`;
  const pages = mergeList<Page>(ctx, "pages", { label: "Pages" }, bp, mp, tp, (p) => ({ label: `Page ${pageTitle(p)}`, pageId: p.id }), (b, m, t) => {
    const { sections: bs, ...bf } = b;
    const { sections: ms, ...mf } = m;
    const { sections: ts, ...tf } = t;
    const where = { label: `Page ${pageTitle(m)}`, pageId: m.id };
    const fields = mergeValue(ctx, `page:${m.id}`, where, bf, mf, tf) as Omit<Page, "sections">;
    const describe = (s: Section): Where => ({ label: `${sectionDef(s.type)?.label ?? s.type} on ${pageTitle(m)}`, pageId: m.id, sectionId: s.id });
    const sections = mergeList<Section>(ctx, `sections:${m.id}`, { label: `Sections on ${pageTitle(m)}`, pageId: m.id }, bs, ms, ts, describe, (sb, sm, st) => mergeValue(ctx, `section:${sm.id}`, describe(sm), sb, sm, st) as Section);
    return { ...fields, sections };
  });
  return { doc: { ...site, pages }, conflicts: ctx.conflicts, fromBranch: ctx.fromBranch, fromMain: ctx.fromMain };
}
