import type { Metadata } from "next";
import { InvoicingApp } from "@/components/invoicing/invoicing-app";

export const metadata: Metadata = { title: "Invoices & quotations" };

export default async function Page({ params }: PageProps<"/projects/[projectId]/invoicing/[[...path]]">) {
  const { projectId, path } = await params;
  return <InvoicingApp projectId={projectId} path={path ?? []} />;
}
