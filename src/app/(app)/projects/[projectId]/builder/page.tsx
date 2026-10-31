import type { Metadata } from "next";
import { BuilderClient } from "@/components/builder/builder-client";

export const metadata: Metadata = { title: "Website builder" };

export default async function Page({ params, searchParams }: PageProps<"/projects/[projectId]/builder">) {
  const { projectId } = await params;
  const { branch } = await searchParams;
  // Remount per branch so history, autosave and selection start fresh.
  const branchId = typeof branch === "string" && /^[0-9a-f-]{36}$/i.test(branch) ? branch : null;
  return <BuilderClient key={branchId ?? "main"} projectId={projectId} branchId={branchId} />;
}
