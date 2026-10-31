import type { Metadata } from "next";
import { BiApp } from "@/components/bi/bi-app";

export const metadata: Metadata = { title: "Reports" };

export default async function Page({ params }: PageProps<"/reports/[[...path]]">) {
  const { path } = await params;
  return <BiApp path={path ?? []} />;
}
