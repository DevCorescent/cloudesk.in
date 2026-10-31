import type { Metadata } from "next";
import { ConstructionApp } from "@/components/construction/construction-app";

export const metadata: Metadata = { title: "Construction" };

export default async function Page({ params }: PageProps<"/construction/[[...path]]">) {
  const { path } = await params;
  return <ConstructionApp path={path ?? []} />;
}
