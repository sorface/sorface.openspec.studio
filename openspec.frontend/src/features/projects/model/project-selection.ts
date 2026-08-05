import type { Project } from "./project-types";

export const ACTIVE_PROJECT_STORAGE_KEY = "openspec-studio.active-project";

export function resolveActiveProjectId(projects: Project[], preferredId: string | null): string | null {
  if (preferredId && projects.some((project) => project.id === preferredId)) return preferredId;
  return projects[0]?.id ?? null;
}

export function nextProjectIdAfterDelete(projects: Project[], deletedId: string): string | null {
  const index = projects.findIndex((project) => project.id === deletedId);
  if (index === -1) return projects[0]?.id ?? null;
  return projects[index + 1]?.id ?? projects[index - 1]?.id ?? null;
}
