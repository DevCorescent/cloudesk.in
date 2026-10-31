import { describe, expect, it } from "vitest";
import { buildRows, clean, matchColumns, plain, rowErrors, tableFrom, toDate, toNumber, validateRow, type Target } from "@/lib/import/engine";

const target: Target = {
  id: "t",
  label: "People",
  noun: "person",
  fields: [
    { key: "name", label: "Name", type: "text", required: true, aliases: ["full name", "employee name"] },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", type: "phone", aliases: ["mobile", "contact no"] },
    { key: "joined", label: "Joining date", type: "date", aliases: ["doj", "date of joining"] },
    { key: "ctc", label: "CTC", type: "money", aliases: ["salary", "annual ctc"] },
    { key: "state", label: "State", type: "state" },
    { key: "type", label: "Type", type: "enum", options: [{ value: "full_time", label: "Full-time", aliases: ["permanent", "fte"] }, { value: "contract", label: "Contract" }] },
    { key: "active", label: "Active", type: "bool" },
  ],
};

describe("smart import engine", () => {
  it("finds the header under title rows and drops empty columns", () => {
    const grid = [["Saffron House — staff list", "", ""], ["", "", ""], ["Employee Name", "Mobile", "DOJ", ""], ["Asha", "98201 33410", "24/10/2026", ""], ["", "", "", ""], ["Ravi", "+91-9876543210", "5-Oct-26", ""]];
    const t = tableFrom(grid, target);
    expect(t.headerRow).toBe(2);
    expect(t.headers).toEqual(["Employee Name", "Mobile", "DOJ"]);
    expect(t.rows).toHaveLength(2);
  });

  it("matches columns by heading, near-heading and by their values", () => {
    const headers = ["Full Name", "E-mail ID", "Contact No.", "Annual CTC (₹)", "Col5"];
    const rows = [["A", "a@x.in", "9820133410", "6,00,000", "27AAJFS2290K1ZQ"]];
    const m = matchColumns(headers, rows, target).map((x) => x.field);
    expect(m.slice(0, 4)).toEqual(["name", "email", "phone", "ctc"]);
    // An unlabeled column of emails is found by its values.
    const sniff = matchColumns(["Name", "X"], [["A", "a@b.co"], ["B", "c@d.in"]], target);
    expect(sniff[1]).toMatchObject({ field: "email" });
    expect(sniff[1].why).toMatch(/email addresses/);
  });

  it("reads Indian numbers, dates and shorthand", () => {
    expect(toNumber("₹1,23,456.50")).toBe(123456.5);
    expect(toNumber("Rs. 499/-")).toBe(499);
    expect(toNumber("1.5 lakh")).toBe(150000);
    expect(toNumber("2cr")).toBe(20000000);
    expect(toNumber("12k")).toBe(12000);
    expect(toNumber("1.234,56")).toBe(1234.56);
    expect(toNumber("(500)")).toBe(-500);
    expect(toNumber("1,000.00 Cr")).toBe(1000);
    expect(toDate("24/10/2026")).toBe("2026-10-24");
    expect(toDate("5-Oct-26")).toBe("2026-10-05");
    expect(toDate("Oct 5, 2026")).toBe("2026-10-05");
    expect(toDate(46319)).toBe("2026-10-24");
    expect(toDate("31/02/2026")).toBeNull();
  });

  it("cleans values and suggests fixes", () => {
    expect(clean("09820133410", { key: "p", label: "Phone", type: "phone" }).value).toBe("+91 98201 33410");
    expect(clean("asha@gmail,com", { key: "e", label: "Email", type: "email" })).toMatchObject({ value: null, suggestion: { value: "asha@gmail.com" } });
    expect(clean("Maharastra", { key: "s", label: "State", type: "state" })).toMatchObject({ value: null, suggestion: { value: "MH" } });
    expect(clean("27", { key: "s", label: "State", type: "state" }).value).toBe("MH");
    expect(clean("Orissa", { key: "s", label: "State", type: "state" }).value).toBe("OD");
    expect(clean("Permanent", target.fields[6]).value).toBe("full_time");
    expect(clean("Contrat", target.fields[6])).toMatchObject({ suggestion: { value: "contract" } });
    expect(clean("✓", target.fields[7]).value).toBe(true);
    expect(clean("", target.fields[0]).error).toBe("Name is needed");
  });

  it("builds rows, fills blanks from a value for everyone, and counts problems", () => {
    const rows = buildRows([["Asha", "", "full time"], ["", "x@y", ""]], ["name", "state", "type"], target, { state: "KA" });
    expect(rows[0].state.value).toBe("KA");
    expect(rows[0].type.value).toBe("full_time");
    expect(rowErrors(rows[0])).toBe(0);
    expect(rowErrors(rows[1])).toBe(2); // no name, and “x@y” isn't a state
    expect(plain(rows[0])).toMatchObject({ name: "Asha", state: "KA", ctc: null });
  });

  it("re-checks rows on the server with the same rules", () => {
    expect(validateRow({ name: "Asha", ctc: 60000000, state: "Karnataka" }, target)).toMatchObject({ ok: true, values: { ctc: 60000000, state: "KA" } });
    expect(validateRow({ name: "" }, target)).toMatchObject({ ok: false, error: "Name is needed" });
  });
});
