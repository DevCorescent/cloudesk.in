import { headers } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { SessionProvider } from "@/components/shell/session-context";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/server/auth/page-session";
import { partnerOf } from "@/server/partners/core";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-pathname") ?? "/home";
  const { user, orgs, activeOrg } = await requirePageSession(path);
  if (!activeOrg) {
    // Partners without a workspace of their own have their dashboard.
    if (await partnerOf(user.id)) redirect("/partner");
    return <p className="p-8 text-sm text-muted">Your account is not a member of any organization. Ask an owner to invite you.</p>;
  }
  return (
    <SessionProvider value={{ user, orgs, org: activeOrg }}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
