import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { fontCss, pageOf, type PMNode } from "@/lib/documents/write";
import { toHtml } from "@/server/documents/convert";
import { byLink } from "@/server/documents/drive";
import { publicFileBytes } from "@/server/documents/tools";
import { PublicFile } from "@/components/documents/viewer/public-file";
import "@/components/documents/docs.css";

// A document someone shared by link: read-only, no sign-in, with a PDF download.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/read/[token]">): Promise<Metadata> {
  const { token } = await params;
  const f = await byLink(token);
  return { title: f?.title ?? "Document", robots: { index: false, follow: false } };
}

export default async function Page({ params }: PageProps<"/read/[token]">) {
  const { token } = await params;
  const f = await byLink(token);
  if (!f) notFound();
  if (f.kind === "file") {
    const v = await publicFileBytes(f.id);
    if (!v) notFound();
    return (
      <div className="doc-desk min-h-dvh">
        <header className="glass-bar sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4 sm:px-6">
          <Wordmark className="text-[19px]" />
          <span className="hidden h-5 w-px bg-border sm:block" />
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{f.title}</p>
          <a href={`/read/${token}/download`} className="inline-flex h-9 shrink-0 items-center rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">
            Download
          </a>
        </header>
        <PublicFile token={token} mime={v.mime} title={f.title} />
      </div>
    );
  }
  const page = pageOf(f.page);
  const html = toHtml((f.content as PMNode) ?? { type: "doc", content: [] }, { title: f.title, page, assetUrl: (id) => `/read/${token}/a/${id}` });
  return (
    <div className="doc-desk min-h-dvh">
      <header className="glass-bar sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4 sm:px-6">
        <Wordmark className="text-[19px]" />
        <span className="hidden h-5 w-px bg-border sm:block" />
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{f.title}</p>
        <a href={`/read/${token}/download`} className="inline-flex h-9 shrink-0 items-center rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">
          Download PDF
        </a>
      </header>
      <main className="px-0 py-0 md:px-6 md:py-10">
        <article className="doc-paper pageless" style={{ ["--doc-font" as string]: fontCss(page.font), ["--doc-size" as string]: `${page.fontSize}pt`, ["--doc-lh" as string]: page.lineHeight }}>
          <div className="doc-content" dangerouslySetInnerHTML={{ __html: html }} />
        </article>
        <p className="py-8 text-center text-[12px] text-subtle">Shared with you from Cloudesk · read-only</p>
      </main>
    </div>
  );
}
