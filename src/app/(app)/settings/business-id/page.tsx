import type { Metadata } from "next";
import { BusinessIdView } from "./view";

export const metadata: Metadata = { title: "Business ID" };

export default function Page() {
  return <BusinessIdView />;
}
