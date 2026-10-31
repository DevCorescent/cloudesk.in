import type { Metadata } from "next";
import { HelpdeskApp } from "@/components/helpdesk/helpdesk-app";

export const metadata: Metadata = { title: "Helpdesk" };

export default async function Page({ params }: PageProps<"/helpdesk/[[...path]]">) {
  const { path } = await params;
  return <HelpdeskApp path={path ?? []} />;
}
