import type { Metadata } from "next";
import { IdentityView } from "./view";

export const metadata: Metadata = { title: "Identity" };

export default function Page() {
  return <IdentityView />;
}
