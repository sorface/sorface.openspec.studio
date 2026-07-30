export interface HealthResponse {
  service: "openspec-studio";
  status: "ready";
}

export interface SessionResponse {
  csrfToken: string;
}

export interface ToolCapability {
  name: string;
  available: boolean;
  path?: string;
  version?: string;
  supported?: boolean;
  nonInteractive?: boolean;
  models?: string[];
}

export interface SystemCapabilities {
  os: string;
  arch: string;
  tools: ToolCapability[];
}

export type ServerStatus = "checking" | "ready" | "demo";
