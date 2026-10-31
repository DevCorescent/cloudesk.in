"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Dashboard } from "@/components/home/dashboard";
import { useSession } from "@/components/shell/session-context";
import { Skeleton } from "@/components/ui/primitives";

export function HomeView() {
  const { org } = useSession();
  // Employees only have their own HR here.
  return org.role === "employee" ? <ToHr /> : <Dashboard />;
}

function ToHr() {
  const router = useRouter();
  useEffect(() => router.replace("/hr"), [router]);
  return <Skeleton className="m-8 h-48 rounded-[24px]" />;
}
