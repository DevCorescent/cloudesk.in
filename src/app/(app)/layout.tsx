import { headers } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { SessionProvider } from "@/components/shell/session-context";
import { PendingInvites } from "@/components/shell/pending-invites";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/server/auth/page-session";
import { partnerOf } from "@/server/partners/core";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-pathname") ?? "/home";
  const { user, orgs, activeOrg } = await requirePageSession(path);
  if (!activeOrg) {
    // Partners without a workspace of their own have their dashboard.
    if (await partnerOf(user.id)) redirect("/partner");
    return (
      <div className="mx-auto max-w-xl p-8">
        <PendingInvites standalone />
      </div>
    );
  }
  return (
    <SessionProvider value={{ user, orgs, org: activeOrg }}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
