import type { Metadata } from "next";
import { SalesApp } from "@/components/sales/sales-app";

export const metadata: Metadata = { title: "Sales" };

export default async function Page({ params }: PageProps<"/sales/[[...path]]">) {
  const { path } = await params;
  return <SalesApp path={path ?? []} />;
}
