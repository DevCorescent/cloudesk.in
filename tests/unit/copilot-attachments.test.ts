import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { countAttached, filesOf, findAttached, forModel, toBlocks } from "@/server/copilot/attachments";
import { toView } from "@/lib/copilot/model";

// Files added to a copilot question: photos and PDFs go as they are, Office and
// text files as their text; each is numbered, kept for later, and the storage
// markers never reach the model.
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

function zip(files: Record<string, string>) {
  const c = XLSX.CFB.utils.cfb_new({ root: "zip" } as never);
  for (const [path, text] of Object.entries(files)) XLSX.CFB.utils.cfb_add(c, path, Buffer.from(text));
  return Buffer.from(XLSX.CFB.write(c, { type: "buffer", fileType: "zip" }) as Uint8Array);
}

describe("copilot attachments", () => {
  it("sends photos and PDFs as they are, numbered after the files already there", () => {
    const { blocks, attached } = toBlocks([{ name: "receipt.png", bytes: PNG }, { name: "bill.pdf", bytes: PDF }], 2);
    expect(attached.map((a) => [a.id, a.mime])).toEqual([["f3", "image/png"], ["f4", "application/pdf"]]);
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "text", "document"]);
    expect(String(blocks[0]!.text)).toMatch(/^\[Attachment f3: “receipt\.png” — PNG/);
  });

  it("reads spreadsheets, Word and PowerPoint as text", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Item", "Price"], ["Cotton shirt", 450], ["Linen shirt", 1299]]), "Prices");
    const xlsx = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array);
    const docx = zip({ "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>1. Term: 12 months</w:t></w:r></w:p><w:p><w:r><w:t>2. Fee: Rs 50,000 &amp; GST</w:t></w:r></w:p></w:body></w:document>" });
    const pptx = zip({ "ppt/slides/slide2.xml": "<p:sld><a:p><a:t>Targets</a:t></a:p></p:sld>", "ppt/slides/slide1.xml": "<p:sld><a:p><a:t>Q3 review</a:t></a:p></p:sld>" });
    const { blocks } = toBlocks([{ name: "prices.xlsx", bytes: xlsx }, { name: "agreement.docx", bytes: docx }, { name: "deck.pptx", bytes: pptx }], 0);
    const texts = blocks.map((b) => String(b.text));
    expect(texts[0]).toContain("Cotton shirt,450");
    expect(texts[1]).toContain("1. Term: 12 months\n2. Fee: Rs 50,000 & GST");
    expect(texts[2]!.indexOf("Q3 review")).toBeLessThan(texts[2]!.indexOf("Targets"));
  });

  it("refuses what it can't read, and more than 4 MB at once", () => {
    expect(() => toBlocks([{ name: "app.exe", bytes: Buffer.from("MZ\u0090\u0000binary") }], 0)).toThrow(/can't be read here/);
    expect(() => toBlocks([{ name: "big.pdf", bytes: Buffer.concat([PDF, Buffer.alloc(4.2 * 1024 * 1024)]) }], 0)).toThrow(/4 MB/);
  });

  it("keeps the originals for later, shows them as chips, and strips the markers for the model", () => {
    const csv = Buffer.from("name,qty\nshirts,200\n");
    const { blocks } = toBlocks([{ name: "photo.png", bytes: PNG }, { name: "stock.csv", bytes: csv }], 0);
    const messages = [{ role: "user", content: [...blocks, { type: "text", text: "What's this?" }] }];
    expect(countAttached(messages)).toBe(2);
    expect(findAttached(messages, "f2")).toMatchObject({ name: "stock.csv", bytes: csv });
    expect(findAttached(messages, "f1")?.bytes.equals(PNG)).toBe(true);
    expect(filesOf(messages[0]!.content).map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(JSON.stringify(forModel(messages))).not.toMatch(/cc_file|cc_data/);
    // The conversation shows the question with its files, not the files' text.
    expect(toView(messages)).toEqual([{ role: "user", text: "What's this?", files: [{ id: "f1", name: "photo.png", mime: "image/png" }, { id: "f2", name: "stock.csv", mime: "text/csv" }] }]);
  });
});
