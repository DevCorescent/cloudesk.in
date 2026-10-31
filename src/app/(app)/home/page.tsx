import type { Metadata } from "next";
import { HomeView } from "./view";

export const metadata: Metadata = { title: "Home" };

export default function Page() {
  return <HomeView />;
}
