import { describe, expect, it } from "vitest";
import { diagnose } from "@/lib/site/diagnostics";
import { align, bounds, freeformItems, moveTogether } from "@/lib/site/freeform";
import { detach, instancesOf, instantiate, makeGlobal, outOfSync, syncGlobal, unlinkGlobal } from "@/lib/site/globals";
import { createSection, parseSiteDoc, siteDocSchema, type SiteDoc } from "@/lib/site/model";
import { composeSite, planFromBrief } from "@/lib/site/planner";
import { renderPage } from "@/lib/site/render";

const site = (): SiteDoc => {
  const d = composeSite(planFromBrief("A bakery in Pune with cakes and a contact form", { name: "Crumb" }));
  d.pages.push({ ...structuredClone(d.pages[0]), id: "p_two", path: "/two", title: "Two", sections: [createSection("faq")] });
  return d;
};

describe("global components", () => {
  it("keeps instances in sync, detaches and unlinks", () => {
    const d = site();
    const banner = createSection("banner");
    d.pages[0].sections.unshift(banner);
    const gid = makeGlobal(d, banner, "Announcement");
    expect(d.globals).toEqual([{ id: gid, name: "Announcement" }]);
    const copy = instantiate(d, gid)!;
    expect(copy.id).not.toBe(banner.id);
    d.pages[1].sections.unshift(copy);
    expect(siteDocSchema.safeParse(d).success).toBe(true);

    copy.props.text = "Closed on Monday";
    expect(syncGlobal(d, copy)).toBe(1);
    expect(banner.props.text).toBe("Closed on Monday");
    const html = renderPage(d, d.pages[1], { kind: "publish" } as never);
    expect(html).toContain("Closed on Monday");

    // An edit that bypassed sync (e.g. raw JSON) is reported.
    banner.props.text = "Different";
    expect(outOfSync(d)).toEqual([{ globalId: gid, name: "Announcement", pages: ["/about"] }]);
    expect(diagnose(d).some((x) => x.message.startsWith("Global component “Announcement” differs"))).toBe(true);
    syncGlobal(d, banner);
    expect(outOfSync(d)).toEqual([]);

    detach(copy);
    expect(instancesOf(d, gid)).toHaveLength(1);
    unlinkGlobal(d, gid);
    expect(d.globals).toEqual([]);
    expect(banner.globalId).toBeUndefined();
    expect(parseSiteDoc(JSON.stringify(d)).ok).toBe(true);
  });

  it("rejects malformed global ids", () => {
    const d = site();
    (d.pages[0].sections[0] as { globalId?: string }).globalId = "bad id";
    expect(siteDocSchema.safeParse(d).success).toBe(false);
  });
});

describe("free-form layout tools", () => {
  const boxes = [
    { x: 1, y: 2, w: 3, h: 2 },
    { x: 6, y: 0, w: 2, h: 4 },
    { x: 9, y: 5, w: 3, h: 1 },
  ];
  it("aligns and distributes on the grid", () => {
    expect(bounds(boxes)).toEqual({ x: 1, y: 0, w: 11, h: 6 });
    expect(align(boxes, "left").map((b) => b.x)).toEqual([1, 1, 1]);
    expect(align(boxes, "right").map((b) => b.x + b.w)).toEqual([12, 12, 12]);
    expect(align(boxes, "top").map((b) => b.y)).toEqual([0, 0, 0]);
    expect(align(boxes, "bottom").map((b) => b.y + b.h)).toEqual([6, 6, 6]);
    expect(align(boxes, "hcenter").map((b) => b.x)).toEqual([5, 6, 5]);
    // Widths 3+2+3 in a span of 11: gaps of 1.5 → x 1, 5.5→6 (rounded), 9
    expect(align(boxes, "hdistribute").map((b) => b.x)).toEqual([1, 6, 9]);
  });

  it("moves a selection together without leaving the grid", () => {
    expect(moveTogether(boxes, 5, 0, 12, 10).map((b) => b.x)).toEqual([1, 6, 9]); // already at the right edge
    expect(moveTogether(boxes, -3, 2, 12, 10).map((b) => [b.x, b.y])).toEqual([[0, 4], [5, 2], [8, 7]]);
  });

  it("reads groups and locks without affecting rendering", () => {
    const items = freeformItems({ rows: 10, items: [{ kind: "text", text: "a", group: "g1", locked: true }, { kind: "text", text: "b", group: "../x" }] });
    expect(items.map((i) => [i.group, i.locked])).toEqual([["g1", true], [null, false]]);
  });
});
