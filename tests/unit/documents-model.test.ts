import { describe, expect, it } from "vitest";
import { addMonths, contractTerm, sniffFile, turn } from "@/lib/documents/model";
import { textPdf } from "@/lib/documents/pdf";

describe("contracts", () => {
  it("rolls an auto-renewing contract forward and finds the notice date", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    const c = { startOn: "2024-04-01", endOn: "2025-03-31", autoRenew: true, renewalMonths: 12, noticeDays: 60, status: "signed" };
    expect(contractTerm(c, "2026-01-10", 30)).toEqual({ termEnd: "2026-03-31", noticeBy: "2026-01-30", renewals: 1, state: "notice_due" });
    expect(contractTerm(c, "2025-06-01", 30)).toMatchObject({ termEnd: "2026-03-31", state: "active" });
    expect(contractTerm({ ...c, autoRenew: false }, "2026-01-10", 30)).toMatchObject({ termEnd: "2025-03-31", noticeBy: null, state: "expired" });
    expect(contractTerm({ ...c, autoRenew: false, endOn: "2026-02-01" }, "2026-01-10", 30).state).toBe("ending");
    expect(contractTerm({ ...c, endOn: null }, "2026-01-10", 30).state).toBe("open_ended");
  });
});

describe("signing", () => {
  it("lets signers sign in order, or all at once, and stops on a decline", () => {
    const s = [{ order: 2, status: "sent" }, { order: 1, status: "signed" }, { order: 3, status: "waiting" }];
    expect(turn(s, true)).toEqual([{ order: 2, status: "sent" }]);
    expect(turn(s, false)).toHaveLength(2);
    expect(turn([...s, { order: 4, status: "declined" }], false)).toEqual([]);
  });
});

describe("files", () => {
  it("knows files by their bytes and refuses the rest", () => {
    expect(sniffFile(Buffer.from("%PDF-1.7 ..."), "x.exe")?.ext).toBe("pdf");
    expect(sniffFile(Buffer.from("PK\x03\x04....[Content_Types].xml word/document.xml"), "a.docx")?.ext).toBe("docx");
    expect(sniffFile(Buffer.from("MZ\x90\x00"), "setup.pdf")).toBeNull();
    expect(sniffFile(Buffer.from("a,b\n1,2\n"), "list.csv")?.mime).toBe("text/csv");
    expect(sniffFile(Buffer.from("a\x00b"), "x.txt")).toBeNull();
  });

  it("writes a PDF that opens: header, pages, an xref that points at its objects", () => {
    const pdf = textPdf([{ text: "Certificate", size: 16, bold: true }, ...Array.from({ length: 80 }, (_, i) => ({ text: `Line ${i} (with brackets) and ₹100` }))], { title: "Test" });
    const s = pdf.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/Count 2");
    expect(s).toContain("\\(with brackets\\)");
    expect(s).toContain("Rs 100");
    const xref = Number(s.match(/startxref\n(\d+)/)![1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const first = Number(s.slice(xref).split("\n")[3].slice(0, 10));
    expect(s.slice(first, first + 7)).toBe("1 0 obj");
  });
});
