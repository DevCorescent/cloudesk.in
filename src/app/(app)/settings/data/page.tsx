import type { Metadata } from "next";
import { DataView } from "./view";

export const metadata: Metadata = { title: "Data" };

export default function Page() {
  return <DataView />;
}
