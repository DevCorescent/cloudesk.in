import { describe, expect, it } from "vitest";
import { mergeDocs } from "@/lib/site/merge";
import { createSection, siteDocSchema, type SiteDoc } from "@/lib/site/model";
import { storeSiteDoc, STORE_TEMPLATES } from "@/lib/store/templates";

const base = () => siteDocSchema.parse(storeSiteDoc(STORE_TEMPLATES[0]));
const hero = (d: SiteDoc) => d.pages[0].sections.find((s) => s.type === "hero")!;

describe("three-way merge of site documents", () => {
  it("takes each side's separate edits, down to individual fields", () => {
    const b = base();
    const main = structuredClone(b);
    const branch = structuredClone(b);
    hero(main).props.heading = "Fresh from main";
    hero(branch).style.background = "accent";
    branch.theme.palette.accent = "#ff3366";
    const r = mergeDocs(b, main, branch);
    expect(r.conflicts).toEqual([]);
    expect(hero(r.doc).props.heading).toBe("Fresh from main");
    expect(hero(r.doc).style.background).toBe("accent");
    expect(r.doc.theme.palette.accent).toBe("#ff3366");
    expect(siteDocSchema.safeParse(r.doc).success).toBe(true);
  });

  it("reports a conflict when both sides change the same thing, and applies the chosen side", () => {
    const b = base();
    const main = structuredClone(b);
    const branch = structuredClone(b);
    hero(main).props.heading = "Main headline";
    hero(branch).props.heading = "Branch headline";
    const r = mergeDocs(b, main, branch);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ id: `section:${hero(b).id}.props.heading`, main: "Main headline", branch: "Branch headline", resolution: null, pageId: b.pages[0].id, sectionId: hero(b).id });
    expect(r.conflicts[0].label).toMatch(/^Hero on .* › heading$/);
    expect(hero(r.doc).props.heading).toBe("Main headline");
    const chosen = mergeDocs(b, main, branch, { [r.conflicts[0].id]: "branch" });
    expect(hero(chosen.doc).props.heading).toBe("Branch headline");
    expect(chosen.conflicts[0].resolution).toBe("branch");
  });

  it("keeps sections and pages added on either side, in sensible places", () => {
    const b = base();
    const main = structuredClone(b);
    const branch = structuredClone(b);
    const fromMain = createSection("faq");
    const fromBranch = createSection("cta");
    main.pages[0].sections.push(fromMain);
    branch.pages[0].sections.splice(1, 0, fromBranch);
    branch.pages.push({ ...structuredClone(b.pages[0]), id: "p-new", path: "/new", title: "New", sections: [createSection("text")] });
    const r = mergeDocs(b, main, branch);
    expect(r.conflicts).toEqual([]);
    const ids = r.doc.pages[0].sections.map((s) => s.id);
    expect(ids[1]).toBe(fromBranch.id);
    expect(ids.at(-1)).toBe(fromMain.id);
    expect(r.doc.pages.map((p) => p.path)).toContain("/new");
    expect(siteDocSchema.safeParse(r.doc).success).toBe(true);
  });

  it("applies deletions from one side, and flags deleting what the other side edited", () => {
    const b = base();
    const main = structuredClone(b);
    const branch = structuredClone(b);
    const [first, second] = b.pages[0].sections.slice(1, 3);
    branch.pages[0].sections = branch.pages[0].sections.filter((s) => s.id !== first.id && s.id !== second.id);
    main.pages[0].sections.find((s) => s.id === second.id)!.style.paddingY = "lg";
    const r = mergeDocs(b, main, branch);
    expect(r.doc.pages[0].sections.some((s) => s.id === first.id)).toBe(false);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].label).toContain("deleted on the branch, edited on main");
    expect(r.doc.pages[0].sections.some((s) => s.id === second.id)).toBe(true);
    expect(mergeDocs(b, main, branch, { [r.conflicts[0].id]: "branch" }).doc.pages[0].sections.some((s) => s.id === second.id)).toBe(false);
  });

  it("follows the side that reordered sections", () => {
    const b = base();
    const main = structuredClone(b);
    const branch = structuredClone(b);
    branch.pages[0].sections.reverse();
    hero(main).props.heading = "Edited";
    const r = mergeDocs(b, main, branch);
    expect(r.conflicts).toEqual([]);
    expect(r.doc.pages[0].sections.map((s) => s.id)).toEqual(branch.pages[0].sections.map((s) => s.id));
    expect(hero(r.doc).props.heading).toBe("Edited");
  });

  it("ignores key order and treats identical edits as agreement", () => {
    const b = base();
    const main = JSON.parse(JSON.stringify(b, Object.keys(b).reverse())) as SiteDoc;
    const branch = structuredClone(b);
    main.name = branch.name = "Same rename";
    const r = mergeDocs(b, main, branch);
    expect(r.conflicts).toEqual([]);
    expect(r.doc.name).toBe("Same rename");
  });
});
