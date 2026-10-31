import type { Metadata } from "next";
import { QualityApp } from "@/components/quality/quality-app";

export const metadata: Metadata = { title: "Quality" };

export default async function Page({ params }: PageProps<"/quality/[[...path]]">) {
  const { path } = await params;
  return <QualityApp path={path ?? []} />;
}
