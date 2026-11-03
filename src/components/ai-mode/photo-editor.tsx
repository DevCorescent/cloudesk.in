"use client";

// The camera's darkroom in AI mode: a photo just taken can be cropped,
// rotated and cleaned up like a scan (whitened page, grey, black and white),
// more pages added, then sent to the AI for analysis with what to do about
// it, attached as it is, saved as a PDF, or filed in Documents. Everything
// happens in the browser; nothing leaves until they choose an action.
import clsx from "clsx";
import { Check, Crop, FilePlus2, FileText, FolderUp, Loader2, RotateCw, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Box = { x: number; y: number; w: number; h: number };
type Filter = "original" | "scan" | "gray" | "bw";
type Page = { id: number; src: HTMLCanvasElement; crop: Box; filter: Filter };

const FULL: Box = { x: 0, y: 0, w: 1, h: 1 };
const MAX_SIDE = 2400;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "scan", label: "Scan" },
  { id: "gray", label: "Grey" },
  { id: "bw", label: "B&W" },
];
/** What to ask about the photo: each a ready prompt. */
export const PHOTO_INTENTS = [
  { id: "analyse", label: "Analyse & recommend", prompt: "Analyse this photo: tell me what it is, what it shows, and recommend the actions I should take." },
  { id: "text", label: "Extract the text", prompt: "Extract all the text in this photo exactly as written, neatly formatted, then tell me if anything needs action." },
  { id: "bill", label: "Record as bill", prompt: "This is a bill or receipt. Read it and prepare it for Accounts." },
  { id: "contact", label: "Add as contact", prompt: "This is a business card or letterhead. Add the person as a contact in the CRM." },
  { id: "stock", label: "Check stock", prompt: "Look at the products or shelves in this photo: what's there, roughly how much, and anything that needs restocking or attention." },
] as const;

let seq = 0;

async function load(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error("Couldn't open that photo"));
      i.src = url;
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function rotate(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.height;
  c.height = src.width;
  const g = c.getContext("2d")!;
  g.translate(c.width, 0);
  g.rotate(Math.PI / 2);
  g.drawImage(src, 0, 0);
  return c;
}

/** The page as it will be saved: cropped, filtered, at most `side` pixels on its long edge. */
function render(p: Page, side = MAX_SIDE, crop = true): HTMLCanvasElement {
  const b = crop ? p.crop : FULL;
  const sx = b.x * p.src.width;
  const sy = b.y * p.src.height;
  const sw = Math.max(1, b.w * p.src.width);
  const sh = Math.max(1, b.h * p.src.height);
  const k = Math.min(1, side / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(p.src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  if (p.filter !== "original") paint(g, c.width, c.height, p.filter);
  return c;
}

/** Scan-style clean-up: the paper's own white becomes white, ink gets darker. */
function paint(g: CanvasRenderingContext2D, w: number, h: number, f: Filter) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(d[i]! * 77 + d[i + 1]! * 150 + d[i + 2]! * 29) >> 8]!++;
  const at = (q: number) => {
    let n = 0;
    const want = (d.length / 4) * q;
    for (let v = 0; v < 256; v++) if ((n += hist[v]!) >= want) return v;
    return 255;
  };
  const black = at(0.02);
  const white = Math.max(black + 40, at(f === "bw" ? 0.6 : 0.9));
  const span = white - black;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i]! * 77 + d[i + 1]! * 150 + d[i + 2]! * 29) >> 8;
    if (f === "scan") {
      for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, ((d[i + c]! - black) * 255) / span));
    } else {
      let v = Math.max(0, Math.min(1, (l - black) / span));
      if (f === "bw") v = v > 0.62 ? 1 : v < 0.38 ? 0 : (v - 0.38) / 0.24;
      d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255);
    }
  }
  g.putImageData(img, 0, 0);
}

const blobOf = (c: HTMLCanvasElement) => new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), "image/jpeg", 0.86));
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-");

async function toPdf(pages: Page[]): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const c = render(p);
    const jpg = await doc.embedJpg(new Uint8Array(await (await blobOf(c)).arrayBuffer()));
    // A4 width, the photo's own proportions.
    const W = 595.28;
    const H = (W * c.height) / c.width;
    doc.addPage([W, H]).drawImage(jpg, { x: 0, y: 0, width: W, height: H });
  }
  doc.setTitle("Scan");
  return new Blob([new Uint8Array(await doc.save())], { type: "application/pdf" });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** The crop frame: drag a corner to resize, the middle to move. */
function CropFrame({ box, onChange }: { box: Box; onChange: (b: Box) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const start = (e: ReactPointerEvent, mode: "move" | "nw" | "ne" | "sw" | "se") => {
    e.preventDefault();
    e.stopPropagation();
    const r = wrap.current!.parentElement!.getBoundingClientRect();
    const b0 = box;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const min = 0.08;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / r.width;
      const dy = (ev.clientY - y0) / r.height;
      let { x, y, w, h } = b0;
      if (mode === "move") {
        x = Math.min(1 - w, Math.max(0, x + dx));
        y = Math.min(1 - h, Math.max(0, y + dy));
      } else {
        if (mode === "nw" || mode === "sw") {
          const nx = Math.min(x + w - min, Math.max(0, x + dx));
          w += x - nx;
          x = nx;
        } else w = Math.min(1 - x, Math.max(min, w + dx));
        if (mode === "nw" || mode === "ne") {
          const ny = Math.min(y + h - min, Math.max(0, y + dy));
          h += y - ny;
          y = ny;
        } else h = Math.min(1 - y, Math.max(min, h + dy));
      }
      onChange({ x, y, w, h });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div ref={wrap} className="pe-crop" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} onPointerDown={(e) => start(e, "move")}>
      <i className="pe-grid" aria-hidden />
      {(["nw", "ne", "sw", "se"] as const).map((c) => (
        <span key={c} className={`pe-h pe-${c}`} onPointerDown={(e) => start(e, c)} aria-hidden />
      ))}
    </div>
  );
}

export function PhotoEditor(p: { file: File; onClose: () => void; onAsk: (files: File[], prompt: string) => void; onAttach: (files: File[]) => void; onSaveDoc?: (file: File) => Promise<string | void> }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [cur, setCur] = useState(0);
  const [cropping, setCropping] = useState(false);
  const [intent, setIntent] = useState<string>(PHOTO_INTENTS[0].id);
  const [busy, setBusy] = useState<"" | "pdf" | "doc" | "ask">("");
  const [note, setNote] = useState("");
  const view = useRef<HTMLCanvasElement>(null);
  const more = useRef<HTMLInputElement>(null);
  const at = Math.max(0, pages.findIndex((x) => x.id === cur));
  const page = pages[at];

  const addFile = (f: File) =>
    load(f).then(
      (src) => {
        const id = ++seq;
        setPages((ps) => [...ps, { id, src, crop: FULL, filter: ps.at(-1)?.filter ?? "original" }]);
        setCur(id);
      },
      (e: unknown) => setNote(e instanceof Error ? e.message : "Couldn't open that photo"),
    );
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void addFile(p.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the first photo, once
  }, []);

  // The preview: the whole photo while cropping (with the frame on it), else the result.
  useEffect(() => {
    const c = view.current;
    if (!c || !page) return;
    const r = render(page, 1400, !cropping);
    c.width = r.width;
    c.height = r.height;
    c.getContext("2d")!.drawImage(r, 0, 0);
  }, [page, cropping]);

  const set = (patch: Partial<Page>) => setPages((ps) => ps.map((x, i) => (i === at ? { ...x, ...patch } : x)));
  const files = async () => Promise.all(pages.slice(0, 4).map(async (x, i) => new File([await blobOf(render(x))], `photo-${stamp()}${pages.length > 1 ? `-${i + 1}` : ""}.jpg`, { type: "image/jpeg" })));
  const run = async (kind: "pdf" | "doc" | "ask" | "attach") => {
    if (!pages.length || busy) return;
    setNote("");
    try {
      if (kind === "attach") return p.onAttach(await files());
      setBusy(kind);
      if (kind === "ask") return p.onAsk(await files(), PHOTO_INTENTS.find((x) => x.id === intent)!.prompt + (pages.length > 1 ? ` (${pages.length} pages)` : ""));
      const pdf = await toPdf(pages);
      const name = `Scan ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.pdf`;
      if (kind === "pdf") {
        download(pdf, name);
        setNote("PDF saved to your downloads");
      } else if (p.onSaveDoc) {
        await p.onSaveDoc(new File([pdf], name, { type: "application/pdf" }));
        setNote("Saved to Documents");
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work — try again");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="pe" role="dialog" aria-modal="true" aria-label="Edit photo">
      <header className="pe-top">
        <button type="button" className="pe-btn" onClick={p.onClose} aria-label="Discard">
          <X className="size-5" />
        </button>
        <span className="pe-title">{pages.length > 1 ? `Page ${at + 1} of ${pages.length}` : "Photo"}</span>
        <div className="pe-tools">
          <button type="button" className={clsx("pe-btn", cropping && "is-on")} onClick={() => setCropping(!cropping)} aria-pressed={cropping} aria-label="Crop">
            {cropping ? <Check className="size-5" /> : <Crop className="size-5" />}
          </button>
          <button type="button" className="pe-btn" disabled={!page} aria-label="Rotate" onClick={() => page && set({ src: rotate(page.src), crop: { x: 1 - (page.crop.y + page.crop.h), y: page.crop.x, w: page.crop.h, h: page.crop.w } })}>
            <RotateCw className="size-5" />
          </button>
          {pages.length > 1 && (
            <button type="button" className="pe-btn" aria-label="Remove this page" onClick={() => (setPages((ps) => ps.filter((x) => x.id !== page!.id)), setCur(pages[at - 1]?.id ?? pages[at + 1]?.id ?? 0))}>
              <Trash2 className="size-5" />
            </button>
          )}
        </div>
      </header>

      <div className="pe-stage">
        {page ? (
          <div className="pe-frame">
            <canvas ref={view} className="pe-img" />
            {cropping && <CropFrame box={page.crop} onChange={(crop) => set({ crop })} />}
          </div>
        ) : (
          <Loader2 className="size-6 animate-spin opacity-60" />
        )}
      </div>

      <div className="pe-bottom">
        {pages.length > 1 && (
          <div className="pe-pages">
            {pages.map((x, i) => (
              <button key={x.id} type="button" className={clsx(i === at && "is-on")} onClick={() => setCur(x.id)} aria-label={`Page ${i + 1}`}>
                {i + 1}
              </button>
            ))}
          </div>
        )}
        <div className="pe-chips" role="radiogroup" aria-label="Look">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={page?.filter === f.id} className={clsx(page?.filter === f.id && "is-on")} onClick={() => set({ filter: f.id })}>
              {f.label}
            </button>
          ))}
          <input ref={more} type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void addFile(f);
          }} />
          <button type="button" onClick={() => more.current?.click()} disabled={pages.length >= 12}>
            <FilePlus2 className="size-3.5" /> Add page
          </button>
        </div>
        <div className="pe-chips pe-intents" role="radiogroup" aria-label="Ask the AI to">
          {PHOTO_INTENTS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={intent === x.id} className={clsx(intent === x.id && "is-on")} onClick={() => setIntent(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        {note && <p className="pe-note" role="status">{note}</p>}
        <div className="pe-actions">
          <button type="button" className="pe-act" onClick={() => run("pdf")} disabled={!pages.length || !!busy}>
            {busy === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} PDF
          </button>
          {p.onSaveDoc && (
            <button type="button" className="pe-act" title="Save to Documents" onClick={() => run("doc")} disabled={!pages.length || !!busy}>
              {busy === "doc" ? <Loader2 className="size-4 animate-spin" /> : <FolderUp className="size-4" />} Save
            </button>
          )}
          <button type="button" className="pe-act" onClick={() => run("attach")} disabled={!pages.length || !!busy}>
            Attach
          </button>
          <button type="button" className="pe-act pe-go" onClick={() => run("ask")} disabled={!pages.length || !!busy}>
            {busy === "ask" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Ask AI
          </button>
        </div>
      </div>
    </div>
  );
}
