import type { Metadata } from "next";
import { NotesApp } from "@/components/notes/app";

export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage({ params }: { params: Promise<{ id?: string[] }> }) {
  const id = (await params).id?.[0] ?? null;
  return <NotesApp initialId={id && /^[0-9a-f-]{36}$/i.test(id) ? id : null} />;
}
