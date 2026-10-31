import type { Metadata } from "next";
import { Suspense } from "react";
import { LogisticsApp } from "@/components/logistics/logistics-app";

export const metadata: Metadata = { title: "Logistics" };

export default async function Page({ params }: PageProps<"/logistics/[[...path]]">) {
  const { path } = await params;
  return (
    <Suspense>
      <LogisticsApp path={path ?? []} />
    </Suspense>
  );
}
