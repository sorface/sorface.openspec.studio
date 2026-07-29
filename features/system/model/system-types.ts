export interface HealthResponse {
  service: "openspec-studio";
  status: "ready";
}

export type ServerStatus = "checking" | "ready" | "demo";
