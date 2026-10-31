import type { Metadata } from "next";
import { SignPage } from "@/components/documents/sign-page";

export const metadata: Metadata = { title: "Sign a document", robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/sign/[token]">) {
  const { token } = await params;
  return <SignPage token={token} />;
}
