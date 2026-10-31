import type { Metadata } from "next";
import { ClinicApp } from "@/components/clinic/clinic-app";

export const metadata: Metadata = { title: "Clinic" };

export default async function Page({ params }: PageProps<"/clinic/[[...path]]">) {
  const { path } = await params;
  return <ClinicApp path={path ?? []} />;
}
