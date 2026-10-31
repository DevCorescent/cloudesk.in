// What a file is and what it can become — shared by the server's converters
// and the viewer's Convert menu, so they always agree.
export type Family = "pdf" | "image" | "word" | "sheet" | "slides" | "markdown" | "text" | "zip" | "other";

export function familyOf(x: { mime: string; ext?: string; filename?: string }): Family {
  const ext = (x.ext ?? x.filename?.split(".").pop() ?? "").toLowerCase();
  if (x.mime === "application/pdf") return "pdf";
  if (x.mime.startsWith("image/")) return "image";
  if (ext === "docx") return "word";
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return "sheet";
  if (ext === "pptx") return "slides";
  if (ext === "md") return "markdown";
  if (ext === "txt" || ext === "json" || ext === "html" || ext === "htm" || x.mime.startsWith("text/") || x.mime === "application/json") return "text";
  if (ext === "zip" || x.mime === "application/zip") return "zip";
  return "other";
}

export const TARGETS = ["pdf", "docx", "doc", "md", "html", "txt", "csv", "xlsx", "json"] as const;
export type Target = (typeof TARGETS)[number];
export const TARGET_LABEL: Record<Target, string> = { pdf: "PDF", docx: "Word (.docx)", doc: "Editable document", md: "Markdown", html: "Web page (.html)", txt: "Plain text", csv: "CSV", xlsx: "Excel (.xlsx)", json: "JSON" };
export const TARGET_LINE: Record<Target, string> = { pdf: "Fixed layout, prints the same everywhere", docx: "Opens in Word and Google Docs", doc: "Edit it here, together, with comments", md: "Plain text with formatting marks", html: "A page any browser opens", txt: "Just the words", csv: "Rows and columns, for any spreadsheet", xlsx: "Every sheet, for Excel", json: "Data for developers and tools" };

/** What each kind of file can become on the server ("written" is a document written here). */
export function targetsFor(family: Family | "written"): Target[] {
  switch (family) {
    case "written":
      return ["pdf", "docx", "md", "html", "txt"];
    case "word":
      return ["doc", "pdf", "md", "html", "txt"];
    case "markdown":
      return ["doc", "pdf", "docx", "html", "txt"];
    case "text":
      return ["doc", "pdf", "docx", "md", "html"];
    case "sheet":
      return ["xlsx", "csv", "json", "pdf", "doc"];
    case "image":
      return ["pdf"];
    case "slides":
      return ["doc", "pdf", "txt"];
    default:
      return [];
  }
}
