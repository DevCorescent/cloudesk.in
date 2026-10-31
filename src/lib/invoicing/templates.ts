// Ready-made document designs. Each is just a TemplateConfig, so anything
// here can be changed in the template studio and saved as the owner's own.
import { defaultTemplateConfig, type TemplateConfig } from "./model";

export type PrebuiltTemplate = { id: string; name: string; description: string; config: TemplateConfig };

const make = (patch: (c: TemplateConfig) => void): TemplateConfig => {
  const c = defaultTemplateConfig();
  patch(c);
  return c;
};

export const PREBUILT_TEMPLATES: PrebuiltTemplate[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Clean and familiar. Logo left, details right, ruled table.",
    config: make((c) => {
      c.layout = "classic";
      c.colors = { accent: "#1f2937", ink: "#111827", muted: "#6b7280", tableHeader: "#f3f4f6" };
    }),
  },
  {
    id: "modern",
    name: "Modern",
    description: "A confident accent colour, rounded table header and airy spacing.",
    config: make((c) => {
      c.layout = "modern";
      c.colors = { accent: "#4f46e5", ink: "#111827", muted: "#6b7280", tableHeader: "#4f46e5" };
      c.font = "geometric";
      c.table.style = "striped";
    }),
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Hairlines and white space. Quiet, premium, nothing extra.",
    config: make((c) => {
      c.layout = "minimal";
      c.colors = { accent: "#111111", ink: "#111111", muted: "#8a8a8a", tableHeader: "#ffffff" };
      c.table.style = "minimal";
      c.table.columns.sn = false;
      c.labels.invoice = "Invoice";
    }),
  },
  {
    id: "band",
    name: "Signature band",
    description: "A full-width colour band carries your name and the document title.",
    config: make((c) => {
      c.layout = "band";
      c.colors = { accent: "#0f766e", ink: "#0f172a", muted: "#64748b", tableHeader: "#e6f4f1" };
      c.logo.position = "left";
    }),
  },
  {
    id: "elegant",
    name: "Elegant",
    description: "Serif type, centred letterhead and fine double rules.",
    config: make((c) => {
      c.layout = "elegant";
      c.colors = { accent: "#7c4a1e", ink: "#231a12", muted: "#7a6a5c", tableHeader: "#f7f1ea" };
      c.font = "serif";
      c.logo.position = "center";
      c.fontSize = 10;
    }),
  },
  {
    id: "compact",
    name: "GST compact",
    description: "Dense boxed grid in the style accountants expect, with HSN tax summary.",
    config: make((c) => {
      c.layout = "compact";
      c.colors = { accent: "#111111", ink: "#000000", muted: "#444444", tableHeader: "#eeeeee" };
      c.table.style = "boxed";
      c.table.columns.unit = true;
      c.fontSize = 8.5;
      c.margin = 10;
    }),
  },
  {
    id: "corporate",
    name: "Corporate",
    description: "A top rule in your colour and a grey details panel. Formal and tidy.",
    config: make((c) => {
      c.layout = "corporate";
      c.colors = { accent: "#1d4ed8", ink: "#0f172a", muted: "#64748b", tableHeader: "#eef2ff" };
      c.font = "humanist";
    }),
  },
  {
    id: "creative",
    name: "Creative",
    description: "Playful shapes and a big highlighted total for studios and makers.",
    config: make((c) => {
      c.layout = "creative";
      c.colors = { accent: "#e8501f", ink: "#1d1a10", muted: "#6f6a58", tableHeader: "#fff3c9" };
      c.font = "geometric";
      c.table.style = "striped";
      c.table.columns.sn = false;
      c.labels.invoice = "Invoice";
    }),
  },
];

export const prebuilt = (id: string) => PREBUILT_TEMPLATES.find((t) => t.id === id);
