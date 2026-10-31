import type { Metadata } from "next";
import { MarketingApp } from "@/components/marketing-app/marketing-app";

export const metadata: Metadata = { title: "Marketing" };

export default async function Page({ params }: PageProps<"/marketing/[[...path]]">) {
  const { path } = await params;
  return <MarketingApp path={path ?? []} />;
}
