import type { Metadata } from "next";
import { WorkApp } from "@/components/work/work-app";

export const metadata: Metadata = { title: "Projects & timesheets" };

export default async function Page({ params }: PageProps<"/work/[[...path]]">) {
  const { path } = await params;
  return <WorkApp path={path ?? []} />;
}
