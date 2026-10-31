"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { AiTask } from "./types";

export const isActive = (s?: AiTask["status"]) => s === "queued" || s === "running";

/** Polls an AI task while it is queued or running. */
export function useTask(taskId: string | null) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api<{ task: AiTask }>(`/api/v1/ai/tasks/${taskId}`).then((r) => r.task),
    enabled: !!taskId,
    refetchInterval: (q) => (isActive(q.state.data?.status) || !q.state.data ? 800 : false),
  });
}
