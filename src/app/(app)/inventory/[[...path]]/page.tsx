import type { Metadata } from "next";
import { InventoryApp } from "@/components/inventory/inventory-app";

export const metadata: Metadata = { title: "Inventory" };

export default async function Page({ params }: PageProps<"/inventory/[[...path]]">) {
  const { path } = await params;
  return <InventoryApp path={path ?? []} />;
}
