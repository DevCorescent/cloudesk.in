import type { Metadata } from "next";
import { DropPage } from "@/components/documents/drop-page";

export const metadata: Metadata = { title: "Upload a document", robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/drop/[token]">) {
  const { token } = await params;
  return <DropPage token={token} />;
}
