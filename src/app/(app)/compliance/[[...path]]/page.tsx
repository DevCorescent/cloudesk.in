import type { Metadata } from "next";
import { GrcApp } from "@/components/grc/grc-app";

export const metadata: Metadata = { title: "Compliance" };

export default async function Page({ params }: PageProps<"/compliance/[[...path]]">) {
  const { path } = await params;
  return <GrcApp path={path ?? []} />;
}
