import type { Metadata } from "next";
import { ObjectsApp } from "@/components/objects/objects-app";

export const metadata: Metadata = { title: "Custom objects" };

export default async function Page({ params }: PageProps<"/objects/[[...path]]">) {
  const { path } = await params;
  return <ObjectsApp path={path ?? []} />;
}
