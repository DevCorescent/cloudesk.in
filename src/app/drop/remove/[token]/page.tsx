import type { Metadata } from "next";
import { RemovePage } from "@/components/documents/drop-page";

export const metadata: Metadata = { title: "Delete your document", robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/drop/remove/[token]">) {
  const { token } = await params;
  return <RemovePage token={token} />;
}
