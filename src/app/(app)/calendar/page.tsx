import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarApp } from "@/components/calendar/calendar-app";

export const metadata: Metadata = { title: "Calendar" };

export default function Page() {
  return (
    <Suspense>
      <CalendarApp />
    </Suspense>
  );
}
