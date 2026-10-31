import type { Metadata } from "next";
import { MaintenanceApp } from "@/components/maintenance/maintenance-app";

export const metadata: Metadata = { title: "Assets & maintenance" };

export default async function Page({ params }: PageProps<"/maintenance/[[...path]]">) {
  const { path } = await params;
  return <MaintenanceApp path={path ?? []} />;
}
