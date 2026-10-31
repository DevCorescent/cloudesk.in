import type { Metadata } from "next";
import { PortalsApp } from "@/components/portal/portals-app";

export const metadata: Metadata = { title: "Portals" };

export default async function Page({ params }: PageProps<"/portals/[[...path]]">) {
  const { path } = await params;
  return <PortalsApp path={path ?? []} />;
}
