import type { Metadata } from "next";
import { EducationApp } from "@/components/education/education-app";

export const metadata: Metadata = { title: "Education" };

export default async function Page({ params }: PageProps<"/school/[[...path]]">) {
  const { path } = await params;
  return <EducationApp path={path ?? []} />;
}
