import type { Metadata } from "next";
import { CalculatorApp } from "@/components/calculator/calculator-app";

export const metadata: Metadata = { title: "Calculator" };

export default function CalculatorPage() {
  return <CalculatorApp />;
}
