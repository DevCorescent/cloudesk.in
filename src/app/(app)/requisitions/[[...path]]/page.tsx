import type { Metadata } from "next";
import { RequisitionsApp } from "@/components/requisitions/app";

export const metadata: Metadata = { title: "Requisitions" };

export default async function Page({ params }: PageProps<"/requisitions/[[...path]]">) {
  const { path } = await params;
  return <RequisitionsApp path={path ?? []} />;
}
