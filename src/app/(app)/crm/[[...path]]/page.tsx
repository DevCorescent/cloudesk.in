import type { Metadata } from "next";
import { CrmApp } from "@/components/crm/crm-app";

export const metadata: Metadata = { title: "CRM" };

export default async function Page({ params }: PageProps<"/crm/[[...path]]">) {
  const { path } = await params;
  return <CrmApp path={path ?? []} />;
}
