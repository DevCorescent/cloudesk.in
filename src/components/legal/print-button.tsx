"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-fg/10 bg-white/60 px-3.5 text-[13px] text-fg/65 transition-colors hover:border-fg/20 hover:text-fg" data-print-hide>
      <Printer className="size-3.5" /> Print or save as PDF
    </button>
  );
}
