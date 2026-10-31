import type { Metadata } from "next";
import { DocumentsApp } from "@/components/documents/documents-app";

export const metadata: Metadata = { title: "Documents" };

export default async function Page({ params }: PageProps<"/documents/[[...path]]">) {
  const { path } = await params;
  return <DocumentsApp path={path ?? []} />;
}
