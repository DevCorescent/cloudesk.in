"use client";

// A file someone shared by link, on its public page: PDFs in the viewer,
// images as they are, anything else as a download.
import { PdfView } from "./pdf-view";
import "../docs.css";

export function PublicFile({ token, mime, title }: { token: string; mime: string; title: string }) {
  const src = `/read/${token}/file`;
  if (mime === "application/pdf") return <PdfView src={src} className="h-[calc(100dvh-56px)]" />;
  if (mime.startsWith("image/"))
    return (
      <div className="grid min-h-[calc(100dvh-56px)] place-items-center p-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- a shared file */}
        <img src={src} alt={title} className="max-h-[85vh] max-w-full rounded-[8px] object-contain shadow-xl" />
      </div>
    );
  return (
    <div className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div>
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="mt-1 text-[13px] text-muted">This file can&apos;t be shown in the browser — download it to open it.</p>
        <a href={`/read/${token}/download`} className="mt-4 inline-flex h-10 items-center rounded-full bg-fg px-5 text-[13.5px] font-semibold text-bg">
          Download
        </a>
      </div>
    </div>
  );
}
