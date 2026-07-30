"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from "@/features/projects/api/projects-client";
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  nextProjectIdAfterDelete,
  resolveActiveProjectId,
} from "@/features/projects/model/project-selection";
import type {
  CreateProjectInput,
  Project,
  ProjectViewStatus,
  UpdateProjectInput,
} from "@/features/projects/model/project-types";
import { getCapabilities } from "@/features/system/api/system-client";
import type { SystemCapabilities } from "@/features/system/model/system-types";

export interface ProjectsController {
  projects: Project[];
  activeProject: Project | null;
  capabilities: SystemCapabilities | null;
  status: ProjectViewStatus;
  error: ApiError | null;
  mutationPending: boolean;
  selectProject: (projectId: string) => void;
  create: (input: CreateProjectInput) => Promise<Project>;
  rename: (projectId: string, name: string) => Promise<Project>;
  remove: (projectId: string) => Promise<void>;
  retry: () => void;
}

function preferredProjectId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistProjectId(projectId: string | null): void {
  try {
    if (projectId) window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
    else window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  } catch {
    // Storage is a preference only; privacy settings must not break the workspace.
  }
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, { code: "UNKNOWN_ERROR", message: "Операция не выполнена", details: error });
}

export function useProjectsController(): ProjectsController {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [status, setStatus] = useState<ProjectViewStatus>("loading");
  const [error, setError] = useState<ApiError | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const mutationChain = useRef(Promise.resolve());

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([listProjects(controller.signal), getCapabilities(controller.signal)])
      .then(([loadedProjects, loadedCapabilities]) => {
        const selectedId = resolveActiveProjectId(loadedProjects, preferredProjectId());
        setProjects(loadedProjects);
        setCapabilities(loadedCapabilities);
        setActiveProjectId(selectedId);
        persistProjectId(selectedId);
        setStatus(loadedProjects.length ? "ready" : "empty");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        const apiError = toApiError(cause);
        setError(apiError);
        setStatus(apiError.code === "NETWORK_ERROR" ? "unavailable" : "error");
      });

    return () => controller.abort();
  }, [reloadVersion]);

  const selectProject = useCallback((projectId: string) => {
    setActiveProjectId((current) => {
      const selected = projects.some((project) => project.id === projectId) ? projectId : current;
      persistProjectId(selected);
      return selected;
    });
  }, [projects]);

  const enqueueMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationChain.current.then(async () => {
      setMutationPending(true);
      setError(null);
      try {
        return await operation();
      } catch (cause) {
        const apiError = toApiError(cause);
        setError(apiError);
        throw apiError;
      } finally {
        setMutationPending(false);
      }
    });
    mutationChain.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const create = useCallback((input: CreateProjectInput) => enqueueMutation(async () => {
    const created = await createProject(input);
    setProjects((current) => [...current, created]);
    setActiveProjectId(created.id);
    persistProjectId(created.id);
    setStatus("ready");
    return created;
  }), [enqueueMutation]);

  const rename = useCallback((projectId: string, name: string) => enqueueMutation(async () => {
    const updated = await updateProject(projectId, { name } satisfies UpdateProjectInput);
    setProjects((current) => current.map((project) => project.id === updated.id ? updated : project));
    return updated;
  }), [enqueueMutation]);

  const remove = useCallback((projectId: string) => enqueueMutation(async () => {
    await deleteProject(projectId);
    setProjects((current) => {
      const nextId = activeProjectId === projectId
        ? nextProjectIdAfterDelete(current, projectId)
        : activeProjectId;
      const remaining = current.filter((project) => project.id !== projectId);
      setActiveProjectId(nextId);
      persistProjectId(nextId);
      setStatus(remaining.length ? "ready" : "empty");
      return remaining;
    });
  }), [activeProjectId, enqueueMutation]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const retry = useCallback(() => {
    setStatus("loading");
    setError(null);
    setReloadVersion((current) => current + 1);
  }, []);

  return {
    projects,
    activeProject,
    capabilities,
    status,
    error,
    mutationPending,
    selectProject,
    create,
    rename,
    remove,
    retry,
  };
}
