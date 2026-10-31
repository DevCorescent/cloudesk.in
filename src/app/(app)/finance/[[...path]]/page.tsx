import type { Metadata } from "next";
import { FinanceApp } from "@/components/finance/finance-app";

export const metadata: Metadata = { title: "Finance" };

export default async function Page({ params }: PageProps<"/finance/[[...path]]">) {
  const { path } = await params;
  return <FinanceApp path={path ?? []} />;
}
