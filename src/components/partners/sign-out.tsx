"use client";

import { LogOut } from "lucide-react";
import { signOut } from "@/components/shell/session-context";

export function SignOutButton() {
  return (
    <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
      <LogOut className="size-4" /> <span className="hidden sm:inline">Sign out</span>
    </button>
  );
}
