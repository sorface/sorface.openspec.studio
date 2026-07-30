import { apiRequest } from "@/features/api/api-client";
import type { HealthResponse, SessionResponse, SystemCapabilities } from "@/features/system/model/system-types";

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/api/v1/system/health", { signal });
}

export async function getSession(signal?: AbortSignal): Promise<SessionResponse> {
  return apiRequest<SessionResponse>("/api/v1/system/session", { signal });
}

export async function getCapabilities(signal?: AbortSignal): Promise<SystemCapabilities> {
  return apiRequest<SystemCapabilities>("/api/v1/system/capabilities", { signal });
}
