import { describe, expect, it } from "vitest";
import { isPartOn, MODULE_IDS, MODULES, moduleForApi, normaliseParts, reachable, visibleTo, withRequirements } from "@/lib/workspace/modules";

describe("workspace modules", () => {
  it("every module sits in a group and parts have unique ids", () => {
    for (const m of MODULES) {
      expect(m.group, m.id).toBeTruthy();
      const ids = (m.parts ?? []).map((p) => p.id);
      expect(new Set(ids).size, m.id).toBe(ids.length);
      for (const r of m.requires ?? []) expect(MODULE_IDS, `${m.id} requires ${r}`).toContain(r);
    }
  });

  it("adds what a module needs, in catalogue order, without duplicates", () => {
    expect(withRequirements(["hr", "crm", "hr"])).toEqual(["crm", "hr"]);
    for (const m of MODULES) for (const r of m.requires ?? []) expect(withRequirements([m.id])).toContain(r);
  });

  it("finds the module and part behind an API path", () => {
    expect(moduleForApi("/api/v1/orgs/o1/hr/payroll/123/finalise")).toMatchObject({ module: "hr", part: "payroll", scope: "org", id: "o1" });
    expect(moduleForApi("/api/v1/orgs/o1/hr/people")).toMatchObject({ module: "hr", part: undefined });
    expect(moduleForApi("/api/v1/orgs/o1/crm/sequences")).toMatchObject({ module: "crm", part: "sequences" });
    expect(moduleForApi("/api/v1/projects/p1/store/products")).toMatchObject({ module: "store", scope: "project", id: "p1" });
    expect(moduleForApi("/api/v1/finance/books")).toMatchObject({ module: "invoicing", scope: "root" });
    expect(moduleForApi("/api/v1/orgs/o1/members")).toBeNull();
    expect(moduleForApi("/api/v1/projects/p1/deployments")).toBeNull();
  });

  it("keeps only known parts switched off", () => {
    expect(normaliseParts({ hr: ["payroll", "nope"], store: ["x"], crm: [] })).toEqual({ hr: ["payroll"] });
    expect(isPartOn({ hr: ["payroll"] }, "hr", "payroll")).toBe(false);
    expect(isPartOn({ hr: ["payroll"] }, "hr", "leave")).toBe(true);
    expect(isPartOn(null, "hr", "leave")).toBe(true);
  });

  it("lets a limited role reach what its modules' screens use", () => {
    const r = reachable(["horeca"]);
    expect(r.has("horeca") && r.has("store") && r.has("invoicing")).toBe(true);
    expect(r.has("hr")).toBe(false);
  });

  it("shows a module only when it's on and in the member's role", () => {
    expect(visibleTo({ modules: null, allowed: null }, "hr")).toBe(true);
    expect(visibleTo({ modules: ["crm"], allowed: null }, "hr")).toBe(false);
    expect(visibleTo({ modules: null, allowed: ["crm"] }, "hr")).toBe(false);
    expect(visibleTo({ modules: null, allowed: ["hr"] }, "hr")).toBe(true);
  });
});

import { purchaseTotals, suggestedOrder, weightedAverage } from "@/lib/inventory/model";
describe("inventory maths", () => {
  it("averages cost by quantity, and an unknown cost doesn't count as free", () => {
    expect(weightedAverage(60, 1200, 40, 1500)).toBe(1320);
    expect(weightedAverage(5, 0, 10, 30000)).toBe(30000);
    expect(weightedAverage(-3, 1000, 5, 2000)).toBe(2000); // negative stock on hand counts as none
  });
  it("splits GST inside a state and across states", () => {
    expect(purchaseTotals([{ qty: 3, rate: 1001, gstRate: 5 }], false).split).toEqual({ igst: 0, cgst: 75, sgst: 75 });
    expect(purchaseTotals([{ qty: 3, rate: 1001, gstRate: 5 }], true).split).toEqual({ igst: 150, cgst: 0, sgst: 0 });
  });
  it("suggests enough to get back above the level, at least the usual order", () => {
    expect(suggestedOrder(2, 0, 10, 24)).toBe(24);
    expect(suggestedOrder(2, 0, 50, 24)).toBe(48);
    expect(suggestedOrder(2, 10, 10, 24)).toBe(0);
  });
});

import { SETUP_LABEL } from "@/lib/workspace/modules";
describe("every module is offered and set up in onboarding", () => {
  it("has a setup line for each module in the catalogue", () => {
    expect(Object.keys(SETUP_LABEL).sort()).toEqual([...MODULE_IDS].sort());
    for (const id of MODULE_IDS) expect(SETUP_LABEL[id].length, id).toBeGreaterThan(10);
  });
});
