import type { Metadata } from "next";
import { CopilotApp } from "@/components/copilot/copilot-app";

export const metadata: Metadata = { title: "Copilot" };

export default async function Page({ params }: PageProps<"/copilot/[[...path]]">) {
  const { path } = await params;
  return <CopilotApp path={path ?? []} />;
}
