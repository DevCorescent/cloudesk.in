import type { Metadata } from "next";
import { HrApp } from "@/components/hr/hr-app";

export const metadata: Metadata = { title: "HR" };

export default async function Page({ params }: PageProps<"/hr/[[...path]]">) {
  const { path } = await params;
  return <HrApp path={path ?? []} />;
}
