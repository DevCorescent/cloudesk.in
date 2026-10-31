import type { Metadata } from "next";
import { AccountsApp } from "@/components/accounts/accounts-app";

export const metadata: Metadata = { title: "Accounts" };

export default async function Page({ params }: PageProps<"/accounts/[[...path]]">) {
  const { path } = await params;
  return <AccountsApp path={path ?? []} />;
}
