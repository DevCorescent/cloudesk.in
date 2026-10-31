"use client";

// Email from anywhere: any screen can open the composer, filled in — who it's
// to, the subject, the message and files (an invoice PDF, a report) — and send
// it from one of your mailboxes in one click. Used by the "Email" buttons on
// records around the app, the header's compose button and ⌘K.
import { Link2, Mail, PenSquare, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { Dialog, Menu } from "@/components/ui/overlays";
import { Button, IconButton, Skeleton } from "@/components/ui/primitives";
import { visibleTo } from "@/lib/workspace/modules";
import { Composer, type ComposePreset } from "./compose";
import { UndoProvider, useMailMeta } from "./shared";

type Ctx = { available: boolean; compose: (p?: ComposePreset) => void };
const ComposeCtx = createContext<Ctx>({ available: false, compose: () => {} });

/** Open the composer from anywhere: `compose({ to: [...], subject, body, attachments })`. */
export const useCompose = () => useContext(ComposeCtx);

export function MailComposeProvider({ children }: { children: ReactNode }) {
  const { org } = useSession();
  const available = visibleTo(org, "mail");
  const [open, setOpen] = useState<{ preset: ComposePreset; key: string } | null>(null);
  const compose = useCallback((preset: ComposePreset = {}) => setOpen({ preset, key: `anywhere-${Date.now()}` }), []);
  const value = useMemo(() => ({ available, compose }), [available, compose]);
  return (
    <ComposeCtx.Provider value={value}>
      <UndoProvider>
        {children}
        {open && available && <ComposeDialog preset={open.preset} draftKey={open.key} onClose={() => setOpen(null)} />}
      </UndoProvider>
    </ComposeCtx.Provider>
  );
}

function ComposeDialog({ preset, draftKey, onClose }: { preset: ComposePreset; draftKey: string; onClose: () => void }) {
  const meta = useMailMeta();
  if (!meta.data) return <Dialog open onClose={onClose} size="lg" title={preset.title ?? "New message"}>{meta.isError ? <p className="text-[13.5px] text-muted">Mail isn&apos;t available right now.</p> : <Skeleton className="h-64" />}</Dialog>;
  if (!meta.data.accounts.length)
    return (
      <Dialog open onClose={onClose} size="sm" title="Connect a mailbox first">
        <div className="grid justify-items-center gap-3 py-4 text-center">
          <span className="grid size-12 place-items-center rounded-[16px] bg-sky-500/10 text-sky-600"><Mail className="size-6" /></span>
          <p className="text-[13.5px] text-muted">Emails go out from your own mailbox — Gmail, Outlook, Zoho or your domain. It takes a minute.</p>
          <Link href="/mail" onClick={onClose} className="inline-flex h-9 items-center rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">Connect a mailbox</Link>
        </div>
      </Dialog>
    );
  return <Composer mode="new" accounts={meta.data.accounts} thread={null} message={null} draftKey={draftKey} preset={preset} onClose={onClose} />;
}

type Who = string | { email?: string | null; name?: string | null } | null | undefined;

/**
 * "Email" on a record: opens the composer filled in. `to` takes addresses or
 * people; empty ones are skipped (and the button still opens a blank email).
 */
export function EmailButton({ to, cc, subject, body, attachments, title, label = "Email", size = "sm", variant = "secondary", iconOnly, className }: { to?: Who[]; cc?: Who[]; subject?: string; body?: string; attachments?: { url: string; filename: string }[]; title?: string; label?: string; size?: "sm" | "md"; variant?: "primary" | "secondary" | "ghost"; iconOnly?: boolean; className?: string }) {
  const { available, compose } = useCompose();
  if (!available) return null;
  const emails = (xs?: Who[]) => [...new Set((xs ?? []).map((x) => (typeof x === "string" ? x : x?.email ?? "")).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))];
  const names = Object.fromEntries([...(to ?? []), ...(cc ?? [])].flatMap((x) => (x && typeof x === "object" && x.email && x.name?.trim() ? [[x.email.trim().toLowerCase(), x.name.trim()]] : [])));
  const open = () => compose({ to: emails(to), cc: emails(cc), names, subject, body, attachments, title });
  const hint = emails(to)[0] ? `Email ${emails(to)[0]}` : "Write an email";
  return iconOnly ? <IconButton size={size} label={hint} icon={<Mail className="size-4" />} onClick={open} className={className} /> : <Button size={size} variant={variant} icon={<Mail className="size-3.5" />} onClick={open} className={className} title={hint}>{label}</Button>;
}

/** The header's compose button: a new email, or one that shares the page you're on. */
export function ComposeAnywhereButton() {
  const { available, compose } = useCompose();
  const router = useRouter();
  if (!available) return null;
  const shareThis = () => {
    // The page's own name, without the " · Cloudesk" suffix.
    const name = document.title.split(/\s+[·|–—-]\s+/)[0]?.trim() || "this page";
    compose({ subject: name, body: `Hi {{first_name}},\n\nHave a look at ${name}:\n${window.location.href}\n\n`, title: "Share this page" });
  };
  return (
    <Menu
      label="Email"
      trigger={(p) => <button type="button" {...p} aria-label="Email" title="Email" className="bar-icon"><Mail aria-hidden /></button>}
      items={[
        { label: "Write an email", icon: <PenSquare />, onSelect: () => compose() },
        { label: "Email this page", icon: <Link2 />, onSelect: shareThis },
        "separator",
        { label: "Contacts & groups", icon: <Users />, onSelect: () => router.push("/mail/contacts") },
      ]}
    />
  );
}
