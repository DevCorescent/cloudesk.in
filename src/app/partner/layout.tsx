import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { SignOutButton } from "@/components/partners/sign-out";
import { getPageSession } from "@/server/auth/page-session";
import { listOrgsForUser } from "@/server/services/orgs";

export const metadata: Metadata = { title: "Partner dashboard — Cloudesk", robots: { index: false, follow: false } };

// The partner dashboard has its own frame: many partners have no workspace.
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession();
  if (!session) redirect("/login?next=/partner");
  const orgs = await listOrgsForUser(session.user.id);
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[88rem] items-center gap-3 px-4 sm:px-8">
          <Link href="/partner" aria-label="Partner dashboard" className="inline-flex items-center gap-2">
            <Wordmark className="text-[20px]" />
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Partners</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-[13px]">
            {orgs.length > 0 && <Link href="/home" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-fg sm:inline-flex">Your workspace</Link>}
            <Link href="/partners" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-fg sm:inline-flex">Program</Link>
            <span className="hidden max-w-[180px] truncate px-2 text-muted md:inline">{session.user.email}</span>
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[88rem] px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
