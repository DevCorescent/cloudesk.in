import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { DocView } from "@/components/notes/render";
import { publicNote } from "@/server/notes/core";

// A note its owner published: read-only, nothing else of the workspace, and
// not indexed by search engines. Turning publishing off breaks the link.
type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = await publicNote((await params).token);
  return { title: n ? `${n.title || "Untitled"} — ${n.org}` : "Note not found", robots: { index: false, follow: false } };
}

export default async function PublicNotePage({ params }: Props) {
  const n = await publicNote((await params).token);
  if (!n) notFound();
  return (
    <div className="min-h-dvh bg-bg">
      <main className="mx-auto max-w-[760px] px-5 py-12 sm:py-16">
        <p className="text-[13px] text-muted">{n.org} · by {n.owner} · updated {new Date(n.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
        <h1 className="mt-3 text-[clamp(2rem,5vw,2.8rem)] leading-tight font-semibold tracking-tight">{n.icon && <span className="mr-2">{n.icon}</span>}{n.title || "Untitled"}</h1>
        <DocView doc={n.content} className="mt-8" />
        <footer className="mt-16 flex items-center gap-2 border-t border-border pt-6 text-[12.5px] text-muted">Shared with <Wordmark className="text-[15px]" /></footer>
      </main>
    </div>
  );
}
