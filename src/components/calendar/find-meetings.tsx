"use client";

// "Find meetings in my email": reads your recent mail again for invites and
// meeting links, adds upcoming invites to your calendar, and says what it found.
import { CalendarSearch } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { useCalApi, useCalRefresh } from "./shared";

export function FindMeetingsButton({ size = "sm", variant = "secondary", className }: { size?: "sm" | "md"; variant?: "secondary" | "primary" | "ghost"; className?: string }) {
  const { call } = useCalApi();
  const refresh = useCalRefresh();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await call<{ mailboxes: number; scanned: number; found: number; added: number }>("meetings/scan", "POST");
      toast({
        tone: "success",
        title: r.found ? `Found ${r.found} ${r.found === 1 ? "meeting" : "meetings"}` : "No new meetings found",
        description: r.mailboxes ? `Checked ${r.scanned} ${r.scanned === 1 ? "email" : "emails"} from the last four months${r.added ? ` — ${r.added} added to your calendar` : ""}.` : "Connect a mailbox in Mail first.",
      });
      refresh();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return <Button size={size} variant={variant} className={className} loading={busy} icon={<CalendarSearch className="size-3.5" />} onClick={() => void run()}>Find meetings in my email</Button>;
}
