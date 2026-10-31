import type { Metadata } from "next";
import { ManufacturingApp } from "@/components/manufacturing/manufacturing-app";

export const metadata: Metadata = { title: "Manufacturing" };

export default async function Page({ params }: PageProps<"/manufacturing/[[...path]]">) {
  const { path } = await params;
  return <ManufacturingApp path={path ?? []} />;
}
