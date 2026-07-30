export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  correlationId?: string;
}

interface ApiErrorEnvelope {
  error?: ApiErrorPayload;
}

interface SessionResponse {
  csrfToken: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly correlationId?: string;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
    this.correlationId = payload.correlationId;
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

let sessionPromise: Promise<string> | undefined;

function isMutation(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}

async function parseError(response: Response): Promise<ApiError> {
  let envelope: ApiErrorEnvelope = {};
  try {
    envelope = await response.json() as ApiErrorEnvelope;
  } catch {
    // The fallback below intentionally hides raw server content.
  }
  return new ApiError(response.status, envelope.error ?? {
    code: "HTTP_ERROR",
    message: `Запрос завершился с кодом ${response.status}`,
    correlationId: response.headers.get("X-Correlation-ID") ?? undefined,
  });
}

async function fetchJson<T>(path: string, options: ApiRequestOptions, retryCsrf: boolean): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (isMutation(method)) {
    headers.set("X-CSRF-Token", await getCsrfToken(options.signal));
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "Локальный backend недоступен",
      details: cause,
    });
  }

  if (!response.ok) {
    const error = await parseError(response);
    if (retryCsrf && isMutation(method) && error.code === "CSRF_REJECTED") {
      sessionPromise = undefined;
      return fetchJson<T>(path, options, false);
    }
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function getCsrfToken(signal?: AbortSignal | null): Promise<string> {
  sessionPromise ??= fetchJson<SessionResponse>(
    "/api/v1/system/session",
    { signal: signal ?? undefined },
    false,
  ).then((session) => session.csrfToken).catch((error) => {
    sessionPromise = undefined;
    throw error;
  });
  return sessionPromise;
}

export function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return fetchJson<T>(path, options, true);
}

export function resetApiSession(): void {
  sessionPromise = undefined;
}
