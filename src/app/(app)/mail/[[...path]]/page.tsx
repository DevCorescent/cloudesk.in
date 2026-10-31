import type { Metadata } from "next";
import { Suspense } from "react";
import { MailApp } from "@/components/mail/mail-app";

export const metadata: Metadata = { title: "Mail" };

export default async function Page({ params }: PageProps<"/mail/[[...path]]">) {
  const { path } = await params;
  return (
    <Suspense>
      <MailApp path={path ?? []} />
    </Suspense>
  );
}
