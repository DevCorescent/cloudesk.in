"use client";

// The two buttons every importable list gets: Import (the smart importer) and
// Export (CSV or Excel of what's on screen).
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { Menu, useToast } from "@/components/ui/overlays";
import { useSession } from "@/components/shell/session-context";
import { api, errorMessage } from "@/lib/client/api";
import { Button } from "@/components/ui/primitives";
import type { Target } from "@/lib/import/engine";
import { downloadRows, type Column } from "./export";
import { SmartImport, type ImportResult } from "./smart-import";

export function ExportMenu({ name, columns, rows, label = "Export" }: { name: string; columns: Column[]; rows: Record<string, unknown>[] | undefined; label?: string }) {
  const { org } = useSession();
  const toast = useToast();
  // The workspace's export rule is checked (and the download logged) before the file is made.
  const download = async (format: "csv" | "xlsx") => {
    try {
      await api(`/api/v1/orgs/${org.id}/masterdata/exports`, { method: "POST", body: { name, rows: rows?.length ?? 0, format, page: window.location.pathname } });
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return;
    }
    await downloadRows(name, columns, rows ?? [], format);
  };
  return (
    <Menu
      label={label}
      trigger={(p) => (
        <Button {...p} size="sm" icon={<Download className="size-3.5" />} disabled={!rows?.length}>
          {label}
        </Button>
      )}
      items={[
        { label: "Excel (.xlsx)", onSelect: () => void download("xlsx") },
        { label: "CSV", onSelect: () => void download("csv") },
      ]}
    />
  );
}

export function ImportButton({ target, onImport, extra, onDone, label = "Import" }: { target: Target; onImport: (rows: Record<string, unknown>[], mode: string) => Promise<ImportResult>; extra?: React.ReactNode; onDone?: (r: ImportResult) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <SmartImport target={target} onClose={() => setOpen(false)} onImport={onImport} extra={extra} onDone={onDone} />}
    </>
  );
}
