import { apiRequest } from "@/features/api/api-client";
import type {
  CreateProjectInput,
  Project,
  ProjectListResponse,
  UpdateProjectInput,
} from "@/features/projects/model/project-types";

const projectsPath = "/api/v1/projects";

export async function listProjects(signal?: AbortSignal): Promise<Project[]> {
  const response = await apiRequest<ProjectListResponse>(projectsPath, { signal });
  return response.items;
}

export function getProject(projectId: string, signal?: AbortSignal): Promise<Project> {
  return apiRequest<Project>(`${projectsPath}/${encodeURIComponent(projectId)}`, { signal });
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return apiRequest<Project>(projectsPath, { method: "POST", body: input });
}

export function updateProject(projectId: string, input: UpdateProjectInput): Promise<Project> {
  return apiRequest<Project>(`${projectsPath}/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteProject(projectId: string): Promise<void> {
  return apiRequest<void>(`${projectsPath}/${encodeURIComponent(projectId)}`, { method: "DELETE" });
}
