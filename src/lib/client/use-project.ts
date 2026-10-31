"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type ProjectDetail = {
  project: { id: string; orgId: string; name: string; slug: string; kind: string; description: string; productionDeploymentId: string | null; createdAt: string; updatedAt: string };
  role: string;
  permissions: string[];
};

export function useProject(projectId: string) {
  return useQuery({ queryKey: ["project", projectId], queryFn: () => api<ProjectDetail>(`/api/v1/projects/${projectId}`) });
}
